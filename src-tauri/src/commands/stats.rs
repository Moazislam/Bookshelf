//! Statistics are derived only from stored activity — nothing is estimated.

use crate::error::AppResult;
use crate::state::AppState;
use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::State;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub documents: i64,
    pub completed: i64,
    pub reading: i64,
    pub unread: i64,
    pub favorites: i64,
    pub pages_read: i64,
    pub reading_seconds: i64,
    pub sessions: i64,
    pub highlights: i64,
    pub notes: i64,
    pub bookmarks: i64,
    pub collections: i64,
    pub total_size: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayActivity {
    pub date: String,
    pub seconds: i64,
    pub pages: i64,
    pub sessions: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub key: String,
    pub count: i64,
    pub seconds: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub totals: Totals,
    pub activity: Vec<DayActivity>,
    pub added_per_month: Vec<Bucket>,
    pub by_format: Vec<Bucket>,
    pub by_status: Vec<Bucket>,
    pub by_collection: Vec<Bucket>,
    pub streak_days: i64,
}

fn scalar(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get::<_, Option<i64>>(0)).ok().flatten().unwrap_or(0)
}

pub fn totals(conn: &Connection) -> Totals {
    Totals {
        documents: scalar(conn, "SELECT count(*) FROM documents"),
        completed: scalar(conn, "SELECT count(*) FROM documents WHERE status = 'completed'"),
        reading: scalar(conn, "SELECT count(*) FROM documents WHERE status = 'reading'"),
        unread: scalar(conn, "SELECT count(*) FROM documents WHERE status = 'unread'"),
        favorites: scalar(conn, "SELECT count(*) FROM documents WHERE favorite = 1"),
        pages_read: scalar(conn, "SELECT sum(pages_read) FROM reading_sessions"),
        reading_seconds: scalar(conn, "SELECT sum(active_seconds) FROM reading_sessions"),
        sessions: scalar(conn, "SELECT count(*) FROM reading_sessions"),
        highlights: scalar(conn, "SELECT count(*) FROM highlights"),
        notes: scalar(conn, "SELECT count(*) FROM notes"),
        bookmarks: scalar(conn, "SELECT count(*) FROM bookmarks"),
        collections: scalar(conn, "SELECT count(*) FROM collections"),
        total_size: scalar(conn, "SELECT sum(file_size) FROM documents"),
    }
}

pub fn activity(conn: &Connection, days: i64) -> AppResult<Vec<DayActivity>> {
    // Generate every day in range (so charts have zero-days), then left-join sessions.
    let v = conn
        .prepare(
            "WITH RECURSIVE days(d) AS (
                SELECT date('now', 'localtime', ?1)
                UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now', 'localtime')
             ),
             s AS (
                SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS d,
                       sum(active_seconds) AS secs, sum(pages_read) AS pages, count(*) AS n
                FROM reading_sessions GROUP BY 1
             )
             SELECT days.d, coalesce(s.secs, 0), coalesce(s.pages, 0), coalesce(s.n, 0)
             FROM days LEFT JOIN s ON s.d = days.d ORDER BY days.d",
        )?
        .query_map([format!("-{} days", days.max(1) - 1)], |r| {
            Ok(DayActivity { date: r.get(0)?, seconds: r.get(1)?, pages: r.get(2)?, sessions: r.get(3)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

fn buckets(conn: &Connection, sql: &str) -> AppResult<Vec<Bucket>> {
    Ok(conn
        .prepare(sql)?
        .query_map([], |r| Ok(Bucket { key: r.get::<_, Option<String>>(0)?.unwrap_or_default(), count: r.get(1)?, seconds: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn streak(conn: &Connection) -> i64 {
    let days: Vec<String> = conn
        .prepare("SELECT DISTINCT date(started_at/1000, 'unixepoch', 'localtime') AS d FROM reading_sessions ORDER BY d DESC LIMIT 400")
        .and_then(|mut s| s.query_map([], |r| r.get(0)).and_then(|m| m.collect()))
        .unwrap_or_default();
    let today: String = conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0)).unwrap_or_default();
    let yesterday: String = conn.query_row("SELECT date('now','localtime','-1 day')", [], |r| r.get(0)).unwrap_or_default();
    let mut expected = match days.first() {
        Some(d) if *d == today || *d == yesterday => d.clone(),
        _ => return 0,
    };
    let mut n = 0;
    for d in days {
        if d != expected {
            break;
        }
        n += 1;
        expected = conn.query_row("SELECT date(?1, '-1 day')", [&d], |r| r.get(0)).unwrap_or_default();
    }
    n
}

#[tauri::command]
pub fn get_stats(state: State<AppState>, days: Option<i64>) -> AppResult<Stats> {
    let conn = state.db.conn();
    let days = days.unwrap_or(30).clamp(7, 366);
    Ok(Stats {
        totals: totals(&conn),
        activity: activity(&conn, days)?,
        added_per_month: buckets(
            &conn,
            "SELECT strftime('%Y-%m', added_at/1000, 'unixepoch', 'localtime') m, count(*), 0
             FROM documents WHERE added_at >= (strftime('%s', 'now', '-12 months') * 1000) GROUP BY m ORDER BY m",
        )?,
        by_format: buckets(
            &conn,
            "SELECT d.format, count(DISTINCT d.id), coalesce((SELECT sum(s.active_seconds) FROM reading_sessions s JOIN documents d2 ON d2.id = s.document_id WHERE d2.format = d.format), 0)
             FROM documents d GROUP BY d.format ORDER BY 2 DESC",
        )?,
        by_status: buckets(&conn, "SELECT status, count(*), 0 FROM documents GROUP BY status")?,
        by_collection: buckets(
            &conn,
            "SELECT c.name, count(DISTINCT dc.document_id), coalesce(sum(s.active_seconds), 0)
             FROM collections c
             LEFT JOIN document_collections dc ON dc.collection_id = c.id
             LEFT JOIN reading_sessions s ON s.document_id = dc.document_id
             GROUP BY c.id ORDER BY 3 DESC, 2 DESC LIMIT 12",
        )?,
        streak_days: streak(&conn),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub document_id: String,
    pub document_title: String,
    pub format: String,
    pub has_cover: bool,
    pub started_at: i64,
    pub ended_at: i64,
    pub active_seconds: i64,
    pub pages_read: i64,
}

#[tauri::command]
pub fn reading_history(state: State<AppState>, limit: Option<i64>, before: Option<i64>) -> AppResult<Vec<HistoryEntry>> {
    let conn = state.db.conn();
    let v = conn
        .prepare(
            "SELECT s.id, s.document_id, d.title, d.format, d.cover_path IS NOT NULL, s.started_at, s.ended_at, s.active_seconds, s.pages_read
             FROM reading_sessions s JOIN documents d ON d.id = s.document_id
             WHERE s.started_at < ?1 ORDER BY s.started_at DESC LIMIT ?2",
        )?
        .query_map(params![before.unwrap_or(i64::MAX), limit.unwrap_or(200).clamp(1, 1000)], |r| {
            Ok(HistoryEntry {
                id: r.get(0)?,
                document_id: r.get(1)?,
                document_title: r.get(2)?,
                format: r.get(3)?,
                has_cover: r.get(4)?,
                started_at: r.get(5)?,
                ended_at: r.get(6)?,
                active_seconds: r.get(7)?,
                pages_read: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}
