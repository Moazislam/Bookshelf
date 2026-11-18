use crate::error::{AppResult, now_ms};
use crate::models::ReadingPosition;
use crate::state::AppState;
use rusqlite::{OptionalExtension, params};
use tauri::State;

#[tauri::command]
pub fn get_reading_position(state: State<AppState>, document_id: String) -> AppResult<Option<ReadingPosition>> {
    let conn = state.db.conn();
    Ok(conn
        .query_row(
            "SELECT document_id, locator, progress, updated_at FROM reading_positions WHERE document_id = ?1",
            [document_id],
            |r| Ok(ReadingPosition { document_id: r.get(0)?, locator: r.get(1)?, progress: r.get(2)?, updated_at: r.get(3)? }),
        )
        .optional()?)
}

/// Persist the current location. Also keeps `documents.progress` and the
/// reading status in sync (unread → reading, reading → completed at the end).
#[tauri::command]
pub fn save_reading_position(state: State<AppState>, document_id: String, locator: String, progress: f64) -> AppResult<()> {
    let progress = progress.clamp(0.0, 1.0);
    let now = now_ms();
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO reading_positions (document_id, locator, progress, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(document_id) DO UPDATE SET locator = excluded.locator, progress = excluded.progress, updated_at = excluded.updated_at",
        params![document_id, locator, progress, now],
    )?;
    tx.execute("UPDATE documents SET progress = ?1 WHERE id = ?2", params![progress, document_id])?;
    if progress >= 0.995 {
        tx.execute("UPDATE documents SET status = 'completed' WHERE id = ?1 AND status = 'reading'", [&document_id])?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn mark_document_opened(state: State<AppState>, document_id: String) -> AppResult<()> {
    let conn = state.db.conn();
    conn.execute(
        "UPDATE documents SET opened_at = ?1, status = CASE WHEN status = 'unread' THEN 'reading' ELSE status END WHERE id = ?2",
        params![now_ms(), document_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn record_reading_session(
    state: State<AppState>,
    document_id: String,
    started_at: i64,
    ended_at: i64,
    active_seconds: i64,
    pages_read: i64,
) -> AppResult<()> {
    if active_seconds < 5 || ended_at < started_at {
        return Ok(());
    }
    // Clamp to wall-clock duration so a buggy client can never inflate statistics.
    let active = active_seconds.min((ended_at - started_at) / 1000 + 1);
    state.db.conn().execute(
        "INSERT INTO reading_sessions (document_id, started_at, ended_at, active_seconds, pages_read) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![document_id, started_at, ended_at, active, pages_read.max(0)],
    )?;
    Ok(())
}

#[tauri::command]
pub fn cache_get(state: State<AppState>, document_id: String, key: String) -> AppResult<Option<String>> {
    Ok(state
        .db
        .conn()
        .query_row("SELECT value FROM document_cache WHERE document_id = ?1 AND key = ?2", [document_id, key], |r| r.get(0))
        .optional()?)
}

#[tauri::command]
pub fn cache_set(state: State<AppState>, document_id: String, key: String, value: String) -> AppResult<()> {
    state.db.conn().execute(
        "INSERT INTO document_cache (document_id, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(document_id, key) DO UPDATE SET value = excluded.value",
        params![document_id, key, value],
    )?;
    Ok(())
}
