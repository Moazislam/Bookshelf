use crate::error::{AppError, AppResult, new_id, now_ms};
use crate::models::{Bookmark, BookmarkInput, Highlight, HighlightInput, Note, NoteInput, NotePatch};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use tauri::State;

const COLORS: &[&str] = &["yellow", "green", "blue", "purple", "red"];

const HL_SELECT: &str = "SELECT h.id, h.document_id, d.title, d.format, h.locator, h.label, h.anchor, h.text,
    h.color, h.comment, h.sort_key, h.created_at, h.updated_at
    FROM highlights h JOIN documents d ON d.id = h.document_id";

fn row_to_highlight(r: &rusqlite::Row) -> rusqlite::Result<Highlight> {
    let anchor: String = r.get(6)?;
    Ok(Highlight {
        id: r.get(0)?,
        document_id: r.get(1)?,
        document_title: r.get(2)?,
        document_format: r.get(3)?,
        locator: r.get(4)?,
        label: r.get(5)?,
        anchor: serde_json::from_str(&anchor).unwrap_or(serde_json::Value::Null),
        text: r.get(7)?,
        color: r.get(8)?,
        comment: r.get(9)?,
        sort_key: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

fn get_highlight(conn: &Connection, id: &str) -> AppResult<Highlight> {
    conn.query_row(&format!("{HL_SELECT} WHERE h.id = ?1"), [id], row_to_highlight)
        .optional()?
        .ok_or_else(|| AppError::NotFound("Highlight not found".into()))
}

#[tauri::command]
pub fn list_highlights(state: State<AppState>, document_id: Option<String>) -> AppResult<Vec<Highlight>> {
    let conn = state.db.conn();
    let v = match document_id {
        Some(d) => conn
            .prepare(&format!("{HL_SELECT} WHERE h.document_id = ?1 ORDER BY h.sort_key, h.created_at"))?
            .query_map([d], row_to_highlight)?
            .collect::<Result<Vec<_>, _>>()?,
        None => conn
            .prepare(&format!("{HL_SELECT} ORDER BY h.created_at DESC"))?
            .query_map([], row_to_highlight)?
            .collect::<Result<Vec<_>, _>>()?,
    };
    Ok(v)
}

#[tauri::command]
pub fn create_highlight(state: State<AppState>, input: HighlightInput) -> AppResult<Highlight> {
    if !COLORS.contains(&input.color.as_str()) {
        return Err(AppError::Invalid("Unknown highlight colour".into()));
    }
    if input.text.trim().is_empty() {
        return Err(AppError::Invalid("Cannot highlight an empty selection".into()));
    }
    let conn = state.db.conn();
    let id = new_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO highlights (id, document_id, locator, label, anchor, text, color, comment, sort_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id,
            input.document_id,
            input.locator,
            input.label,
            serde_json::to_string(&input.anchor)?,
            input.text,
            input.color,
            input.comment.filter(|c| !c.trim().is_empty()),
            input.sort_key,
            now
        ],
    )?;
    get_highlight(&conn, &id)
}

#[tauri::command]
pub fn update_highlight(state: State<AppState>, id: String, color: Option<String>, comment: Option<String>) -> AppResult<Highlight> {
    let conn = state.db.conn();
    if let Some(c) = &color {
        if !COLORS.contains(&c.as_str()) {
            return Err(AppError::Invalid("Unknown highlight colour".into()));
        }
        conn.execute("UPDATE highlights SET color = ?1, updated_at = ?2 WHERE id = ?3", params![c, now_ms(), id])?;
    }
    if let Some(c) = comment {
        let v = if c.trim().is_empty() { None } else { Some(c) };
        conn.execute("UPDATE highlights SET comment = ?1, updated_at = ?2 WHERE id = ?3", params![v, now_ms(), id])?;
    }
    get_highlight(&conn, &id)
}

#[tauri::command]
pub fn delete_highlight(state: State<AppState>, id: String) -> AppResult<()> {
    state.db.conn().execute("DELETE FROM highlights WHERE id = ?1", [&id])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

fn row_to_bookmark(r: &rusqlite::Row) -> rusqlite::Result<Bookmark> {
    Ok(Bookmark {
        id: r.get(0)?,
        document_id: r.get(1)?,
        locator: r.get(2)?,
        label: r.get(3)?,
        description: r.get(4)?,
        sort_key: r.get(5)?,
        created_at: r.get(6)?,
    })
}
const BM_SELECT: &str = "SELECT id, document_id, locator, label, description, sort_key, created_at FROM bookmarks";

#[tauri::command]
pub fn list_bookmarks(state: State<AppState>, document_id: String) -> AppResult<Vec<Bookmark>> {
    let conn = state.db.conn();
    let v = conn
        .prepare(&format!("{BM_SELECT} WHERE document_id = ?1 ORDER BY sort_key, created_at"))?
        .query_map([document_id], row_to_bookmark)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

#[tauri::command]
pub fn create_bookmark(state: State<AppState>, input: BookmarkInput) -> AppResult<Bookmark> {
    let conn = state.db.conn();
    let id = new_id();
    conn.execute(
        "INSERT INTO bookmarks (id, document_id, locator, label, description, sort_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.document_id, input.locator, input.label.trim(), input.description, input.sort_key, now_ms()],
    )?;
    Ok(conn.query_row(&format!("{BM_SELECT} WHERE id = ?1"), [&id], row_to_bookmark)?)
}

#[tauri::command]
pub fn update_bookmark(state: State<AppState>, id: String, label: Option<String>, description: Option<String>) -> AppResult<Bookmark> {
    let conn = state.db.conn();
    if let Some(l) = label {
        conn.execute("UPDATE bookmarks SET label = ?1 WHERE id = ?2", params![l.trim(), id])?;
    }
    if let Some(d) = description {
        conn.execute("UPDATE bookmarks SET description = ?1 WHERE id = ?2", params![if d.trim().is_empty() { None } else { Some(d) }, id])?;
    }
    Ok(conn.query_row(&format!("{BM_SELECT} WHERE id = ?1"), [&id], row_to_bookmark)?)
}

#[tauri::command]
pub fn delete_bookmark(state: State<AppState>, id: String) -> AppResult<()> {
    state.db.conn().execute("DELETE FROM bookmarks WHERE id = ?1", [&id])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const NOTE_SELECT: &str = "SELECT n.id, n.document_id, d.title, n.highlight_id, h.text, n.title, n.body, n.pinned,
    (SELECT group_concat(tag_id) FROM note_tags WHERE note_id = n.id), n.created_at, n.updated_at
    FROM notes n LEFT JOIN documents d ON d.id = n.document_id LEFT JOIN highlights h ON h.id = n.highlight_id";

fn row_to_note(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    let tags: Option<String> = r.get(8)?;
    Ok(Note {
        id: r.get(0)?,
        document_id: r.get(1)?,
        document_title: r.get(2)?,
        highlight_id: r.get(3)?,
        highlight_text: r.get(4)?,
        title: r.get(5)?,
        body: r.get(6)?,
        pinned: r.get::<_, i64>(7)? != 0,
        tag_ids: tags.map(|t| t.split(',').map(String::from).collect()).unwrap_or_default(),
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

fn get_note(conn: &Connection, id: &str) -> AppResult<Note> {
    conn.query_row(&format!("{NOTE_SELECT} WHERE n.id = ?1"), [id], row_to_note)
        .optional()?
        .ok_or_else(|| AppError::NotFound("Note not found".into()))
}

#[tauri::command]
pub fn list_notes(state: State<AppState>, document_id: Option<String>) -> AppResult<Vec<Note>> {
    let conn = state.db.conn();
    let v = match document_id {
        Some(d) => conn
            .prepare(&format!("{NOTE_SELECT} WHERE n.document_id = ?1 ORDER BY n.pinned DESC, n.updated_at DESC"))?
            .query_map([d], row_to_note)?
            .collect::<Result<Vec<_>, _>>()?,
        None => conn
            .prepare(&format!("{NOTE_SELECT} ORDER BY n.pinned DESC, n.updated_at DESC"))?
            .query_map([], row_to_note)?
            .collect::<Result<Vec<_>, _>>()?,
    };
    Ok(v)
}

#[tauri::command]
pub fn create_note(state: State<AppState>, input: NoteInput) -> AppResult<Note> {
    let conn = state.db.conn();
    let id = new_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO notes (id, document_id, highlight_id, title, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, input.document_id, input.highlight_id, input.title, input.body, now],
    )?;
    get_note(&conn, &id)
}

#[tauri::command]
pub fn update_note(state: State<AppState>, id: String, patch: NotePatch) -> AppResult<Note> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    if let Some(t) = &patch.title {
        tx.execute("UPDATE notes SET title = ?1 WHERE id = ?2", params![t, id])?;
    }
    if let Some(b) = &patch.body {
        tx.execute("UPDATE notes SET body = ?1 WHERE id = ?2", params![b, id])?;
    }
    if let Some(p) = patch.pinned {
        tx.execute("UPDATE notes SET pinned = ?1 WHERE id = ?2", params![p as i64, id])?;
    }
    if let Some(d) = &patch.document_id {
        tx.execute("UPDATE notes SET document_id = ?1 WHERE id = ?2", params![d, id])?;
    }
    tx.execute("UPDATE notes SET updated_at = ?1 WHERE id = ?2", params![now_ms(), id])?;
    tx.commit()?;
    get_note(&conn, &id)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: String) -> AppResult<()> {
    state.db.conn().execute("DELETE FROM notes WHERE id = ?1", [&id])?;
    Ok(())
}
