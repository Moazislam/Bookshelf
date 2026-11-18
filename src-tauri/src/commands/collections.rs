use crate::error::{AppError, AppResult, new_id, now_ms};
use crate::models::{Collection, CollectionInput, CollectionPatch, Tag};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use tauri::State;

fn get_collection(conn: &Connection, id: &str) -> AppResult<Collection> {
    conn.query_row(
        "SELECT c.id, c.parent_id, c.name, c.description, c.icon, c.color, c.sort_order, c.created_at,
            (SELECT count(*) FROM document_collections WHERE collection_id = c.id)
         FROM collections c WHERE c.id = ?1",
        [id],
        row_to_collection,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("Collection not found".into()))
}

fn row_to_collection(r: &rusqlite::Row) -> rusqlite::Result<Collection> {
    Ok(Collection {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        name: r.get(2)?,
        description: r.get(3)?,
        icon: r.get(4)?,
        color: r.get(5)?,
        sort_order: r.get(6)?,
        created_at: r.get(7)?,
        document_count: r.get(8)?,
    })
}

#[tauri::command]
pub fn list_collections(state: State<AppState>) -> AppResult<Vec<Collection>> {
    let conn = state.db.conn();
    let mut stmt = conn.prepare(
        "SELECT c.id, c.parent_id, c.name, c.description, c.icon, c.color, c.sort_order, c.created_at,
            (SELECT count(*) FROM document_collections WHERE collection_id = c.id)
         FROM collections c ORDER BY c.sort_order, c.name COLLATE NOCASE",
    )?;
    let v = stmt.query_map([], row_to_collection)?.collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

#[tauri::command]
pub fn create_collection(state: State<AppState>, input: CollectionInput) -> AppResult<Collection> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Collection name cannot be empty".into()));
    }
    let conn = state.db.conn();
    let id = new_id();
    conn.execute(
        "INSERT INTO collections (id, parent_id, name, description, icon, color, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT coalesce(max(sort_order),0)+1 FROM collections), ?7)",
        params![
            id,
            input.parent_id,
            name,
            input.description,
            input.icon.unwrap_or_else(|| "folder".into()),
            input.color.unwrap_or_else(|| "slate".into()),
            now_ms()
        ],
    )?;
    get_collection(&conn, &id)
}

/// Would making `new_parent` the parent of `id` create a cycle?
pub fn creates_cycle(conn: &Connection, id: &str, new_parent: &str) -> AppResult<bool> {
    let mut cur = Some(new_parent.to_string());
    let mut guard = 0;
    while let Some(c) = cur {
        if c == id {
            return Ok(true);
        }
        guard += 1;
        if guard > 1000 {
            return Ok(true);
        }
        cur = conn
            .query_row("SELECT parent_id FROM collections WHERE id = ?1", [&c], |r| r.get::<_, Option<String>>(0))
            .optional()?
            .flatten();
    }
    Ok(false)
}

#[tauri::command]
pub fn update_collection(state: State<AppState>, id: String, patch: CollectionPatch) -> AppResult<Collection> {
    let conn = state.db.conn();
    if let Some(name) = &patch.name {
        if name.trim().is_empty() {
            return Err(AppError::Invalid("Collection name cannot be empty".into()));
        }
        conn.execute("UPDATE collections SET name = ?1 WHERE id = ?2", params![name.trim(), id])?;
    }
    if let Some(d) = &patch.description {
        conn.execute("UPDATE collections SET description = ?1 WHERE id = ?2", params![d, id])?;
    }
    if let Some(i) = &patch.icon {
        conn.execute("UPDATE collections SET icon = ?1 WHERE id = ?2", params![i, id])?;
    }
    if let Some(c) = &patch.color {
        conn.execute("UPDATE collections SET color = ?1 WHERE id = ?2", params![c, id])?;
    }
    if let Some(parent) = &patch.parent_id {
        if let Some(p) = parent {
            if creates_cycle(&conn, &id, p)? {
                return Err(AppError::Invalid("A collection cannot be moved inside itself".into()));
            }
        }
        conn.execute("UPDATE collections SET parent_id = ?1 WHERE id = ?2", params![parent, id])?;
    }
    get_collection(&conn, &id)
}

/// Deleting a collection never deletes documents. Child collections move up one level.
pub fn delete_collection_inner(conn: &mut Connection, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let parent: Option<String> = tx
        .query_row("SELECT parent_id FROM collections WHERE id = ?1", [id], |r| r.get(0))
        .optional()?
        .flatten();
    tx.execute("UPDATE collections SET parent_id = ?1 WHERE parent_id = ?2", params![parent, id])?;
    tx.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn delete_collection(state: State<AppState>, id: String) -> AppResult<()> {
    delete_collection_inner(&mut state.db.conn(), &id)
}

#[tauri::command]
pub fn set_document_collections(state: State<AppState>, document_id: String, collection_ids: Vec<String>) -> AppResult<()> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    let existing: Vec<String> = tx
        .prepare("SELECT collection_id FROM document_collections WHERE document_id = ?1")?
        .query_map([&document_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for cid in existing.iter().filter(|c| !collection_ids.contains(c)) {
        tx.execute("DELETE FROM document_collections WHERE document_id = ?1 AND collection_id = ?2", params![document_id, cid])?;
    }
    for cid in &collection_ids {
        tx.execute(
            "INSERT OR IGNORE INTO document_collections (document_id, collection_id, added_at) VALUES (?1, ?2, ?3)",
            params![document_id, cid, now_ms()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn add_documents_to_collection(state: State<AppState>, document_ids: Vec<String>, collection_id: String) -> AppResult<()> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    for d in &document_ids {
        tx.execute(
            "INSERT OR IGNORE INTO document_collections (document_id, collection_id, added_at) VALUES (?1, ?2, ?3)",
            params![d, collection_id, now_ms()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn remove_documents_from_collection(state: State<AppState>, document_ids: Vec<String>, collection_id: String) -> AppResult<()> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    for d in &document_ids {
        tx.execute("DELETE FROM document_collections WHERE document_id = ?1 AND collection_id = ?2", params![d, collection_id])?;
    }
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

fn get_tag(conn: &Connection, id: &str) -> AppResult<Tag> {
    Ok(conn.query_row(
        "SELECT t.id, t.name, t.color,
            (SELECT count(*) FROM document_tags WHERE tag_id = t.id),
            (SELECT count(*) FROM note_tags WHERE tag_id = t.id)
         FROM tags t WHERE t.id = ?1",
        [id],
        |r| Ok(Tag { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, document_count: r.get(3)?, note_count: r.get(4)? }),
    )?)
}

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> AppResult<Vec<Tag>> {
    let conn = state.db.conn();
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color,
            (SELECT count(*) FROM document_tags WHERE tag_id = t.id),
            (SELECT count(*) FROM note_tags WHERE tag_id = t.id)
         FROM tags t ORDER BY t.name COLLATE NOCASE",
    )?;
    let v = stmt
        .query_map([], |r| Ok(Tag { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, document_count: r.get(3)?, note_count: r.get(4)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

/// Creates a tag, or returns the existing tag with the same (case-insensitive) name.
#[tauri::command]
pub fn create_tag(state: State<AppState>, name: String, color: Option<String>) -> AppResult<Tag> {
    let name = name.trim().trim_start_matches('#').trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("Tag name cannot be empty".into()));
    }
    let conn = state.db.conn();
    if let Some(id) = conn.query_row("SELECT id FROM tags WHERE name = ?1", [&name], |r| r.get::<_, String>(0)).optional()? {
        return get_tag(&conn, &id);
    }
    let id = new_id();
    conn.execute("INSERT INTO tags (id, name, color) VALUES (?1, ?2, ?3)", params![id, name, color.unwrap_or_else(|| "slate".into())])?;
    get_tag(&conn, &id)
}

#[tauri::command]
pub fn update_tag(state: State<AppState>, id: String, name: Option<String>, color: Option<String>) -> AppResult<Tag> {
    let conn = state.db.conn();
    if let Some(n) = name {
        let n = n.trim().trim_start_matches('#').trim().to_string();
        if n.is_empty() {
            return Err(AppError::Invalid("Tag name cannot be empty".into()));
        }
        conn.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![n, id])
            .map_err(|_| AppError::Invalid("A tag with that name already exists".into()))?;
    }
    if let Some(c) = color {
        conn.execute("UPDATE tags SET color = ?1 WHERE id = ?2", params![c, id])?;
    }
    get_tag(&conn, &id)
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, id: String) -> AppResult<()> {
    state.db.conn().execute("DELETE FROM tags WHERE id = ?1", [&id])?;
    Ok(())
}

#[tauri::command]
pub fn set_document_tags(state: State<AppState>, document_id: String, tag_ids: Vec<String>) -> AppResult<()> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM document_tags WHERE document_id = ?1", [&document_id])?;
    for t in &tag_ids {
        tx.execute("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?1, ?2)", params![document_id, t])?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn add_tag_to_documents(state: State<AppState>, document_ids: Vec<String>, tag_id: String) -> AppResult<()> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    for d in &document_ids {
        tx.execute("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?1, ?2)", params![d, tag_id])?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn set_note_tags(state: State<AppState>, note_id: String, tag_ids: Vec<String>) -> AppResult<()> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [&note_id])?;
    for t in &tag_ids {
        tx.execute("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)", params![note_id, t])?;
    }
    tx.commit()?;
    Ok(())
}
