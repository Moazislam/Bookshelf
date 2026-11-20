use crate::document_processing::{self as dp, Format, cover, hash};
use crate::error::{AppError, AppResult, new_id, now_ms};
use crate::filesystem::{external, paths};
use crate::models::{Document, DocumentPatch, TextChunk};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

pub const DOC_SELECT: &str = "SELECT d.id, d.path, d.format, d.file_name, d.title, d.author, d.description,
    d.publisher, d.published, d.language, d.file_size, d.page_count, d.cover_path, d.status, d.favorite,
    d.progress, d.added_at, d.opened_at, d.updated_at, d.missing, d.metadata_ready, d.text_indexed,
    (SELECT group_concat(tag_id) FROM document_tags WHERE document_id = d.id),
    (SELECT group_concat(collection_id) FROM document_collections WHERE document_id = d.id),
    (SELECT count(*) FROM highlights WHERE document_id = d.id),
    (SELECT count(*) FROM notes WHERE document_id = d.id)
    FROM documents d";

fn split_ids(s: Option<String>) -> Vec<String> {
    s.map(|v| v.split(',').filter(|x| !x.is_empty()).map(String::from).collect()).unwrap_or_default()
}

pub fn row_to_document(r: &Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: r.get(0)?,
        path: r.get(1)?,
        format: r.get(2)?,
        file_name: r.get(3)?,
        title: r.get(4)?,
        author: r.get(5)?,
        description: r.get(6)?,
        publisher: r.get(7)?,
        published: r.get(8)?,
        language: r.get(9)?,
        file_size: r.get(10)?,
        page_count: r.get(11)?,
        has_cover: r.get::<_, Option<String>>(12)?.is_some(),
        status: r.get(13)?,
        favorite: r.get::<_, i64>(14)? != 0,
        progress: r.get(15)?,
        added_at: r.get(16)?,
        opened_at: r.get(17)?,
        updated_at: r.get(18)?,
        missing: r.get::<_, i64>(19)? != 0,
        metadata_ready: r.get::<_, i64>(20)? != 0,
        text_indexed: r.get::<_, i64>(21)? != 0,
        tag_ids: split_ids(r.get(22)?),
        collection_ids: split_ids(r.get(23)?),
        highlight_count: r.get(24)?,
        note_count: r.get(25)?,
    })
}

pub fn get_doc(conn: &Connection, id: &str) -> AppResult<Document> {
    conn.query_row(&format!("{DOC_SELECT} WHERE d.id = ?1"), [id], row_to_document)
        .optional()?
        .ok_or_else(|| AppError::NotFound("Document not found".into()))
}

#[tauri::command]
pub fn list_documents(state: State<AppState>) -> AppResult<Vec<Document>> {
    let conn = state.db.conn();
    let mut stmt = conn.prepare(&format!("{DOC_SELECT} ORDER BY d.added_at DESC"))?;
    let docs = stmt.query_map([], row_to_document)?.collect::<Result<Vec<_>, _>>()?;
    Ok(docs)
}

#[tauri::command]
pub fn get_document(state: State<AppState>, id: String) -> AppResult<Document> {
    get_doc(&state.db.conn(), &id)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub job_id: String,
    pub index: usize,
    pub total: usize,
    pub file_name: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub file_name: String,
    pub path: String,
    pub message: String,
    pub existing_id: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub job_id: String,
    pub imported: Vec<String>,
    pub relinked: Vec<String>,
    pub duplicates: Vec<ImportIssue>,
    pub errors: Vec<ImportIssue>,
    /// PDFs that still need metadata/text extraction in the frontend.
    pub pdf_pending: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub job_id: String,
    pub total: usize,
}

pub enum ImportOutcome {
    Imported { id: String, pdf_pending: bool },
    Relinked(String),
    Duplicate(String),
}

pub struct ImportOptions {
    pub copy_to: Option<PathBuf>,
}

pub fn import_one(conn: &mut Connection, covers_dir: &Path, raw: &Path, opts: &ImportOptions) -> AppResult<ImportOutcome> {
    let (path, format) = paths::validate_document_path(&raw.to_string_lossy())?;
    let digest = hash::file_hash(&path)?;

    let existing: Option<(String, String)> = conn
        .query_row("SELECT id, path FROM documents WHERE hash = ?1", [&digest], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    if let Some((id, old_path)) = existing {
        if !Path::new(&old_path).is_file() {
            // Same content, original file is gone: treat the new location as a relink.
            conn.execute(
                "UPDATE documents SET path = ?1, missing = 0, updated_at = ?2 WHERE id = ?3",
                params![path.to_string_lossy(), now_ms(), id],
            )?;
            return Ok(ImportOutcome::Relinked(id));
        }
        return Ok(ImportOutcome::Duplicate(id));
    }

    // Optional "managed library" mode: copy the file into the library folder first.
    let path = match &opts.copy_to {
        Some(dir) if !path.starts_with(dir) => {
            std::fs::create_dir_all(dir)?;
            let dest = paths::unique_destination(dir, &paths::file_name(&path));
            std::fs::copy(&path, &dest)?;
            dest
        }
        _ => path,
    };

    let meta = std::fs::metadata(&path)?;
    let extracted = dp::extract(&path, format)?;
    let id = new_id();
    let now = now_ms();
    let cover_file = match &extracted.cover {
        Some(bytes) => cover::save_cover(bytes, covers_dir, &id)
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())),
        None => None,
    };
    let title = extracted.title.clone().unwrap_or_else(|| paths::file_stem_title(&path));
    let pdf_pending = format == Format::Pdf;

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO documents (id, path, hash, format, file_name, title, author, description, publisher,
            published, language, file_size, page_count, cover_path, added_at, updated_at, metadata_ready, text_indexed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?16)",
        params![
            id,
            path.to_string_lossy(),
            digest,
            format.as_str(),
            paths::file_name(&path),
            title,
            extracted.author,
            extracted.description,
            extracted.publisher,
            extracted.published,
            extracted.language,
            meta.len() as i64,
            extracted.page_count,
            cover_file,
            now,
            (!pdf_pending) as i64,
        ],
    )?;
    {
        let mut stmt = tx.prepare("INSERT INTO doc_text (document_id, locator, label, text) VALUES (?1, ?2, ?3, ?4)")?;
        for c in &extracted.chunks {
            stmt.execute(params![id, c.locator, c.label, c.text])?;
        }
    }
    tx.commit()?;
    Ok(ImportOutcome::Imported { id, pdf_pending })
}

fn read_setting(conn: &Connection, key: &str) -> Option<serde_json::Value> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
pub fn import_paths(
    app: AppHandle,
    state: State<AppState>,
    paths: Vec<String>,
    collection_id: Option<String>,
) -> AppResult<ImportJob> {
    // Picked files can be plain paths (desktop) or content:// URIs (Android).
    enum Source {
        Path(PathBuf),
        Uri(String),
    }
    let (uris, plain): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| external::is_uri(p));
    let mut files: Vec<Source> = paths::expand_import_paths(&plain).into_iter().map(Source::Path).collect();
    files.extend(uris.into_iter().map(Source::Uri));

    let job_id = new_id();
    let total = files.len();
    let db = state.db.clone();
    let covers_dir = state.covers_dir.clone();
    let library_dir = state.library_dir();
    let job = job_id.clone();

    let opts = if cfg!(mobile) {
        // Mobile apps can only rely on files inside their own storage.
        ImportOptions { copy_to: Some(library_dir.clone()) }
    } else {
        let conn = db.conn();
        let copy = read_setting(&conn, "library.copyOnImport").and_then(|v| v.as_bool()).unwrap_or(false);
        let folder = read_setting(&conn, "library.folder").and_then(|v| v.as_str().map(PathBuf::from));
        ImportOptions { copy_to: if copy { folder } else { None } }
    };

    std::thread::spawn(move || {
        let mut report = ImportReport { job_id: job.clone(), ..Default::default() };
        for (index, source) in files.iter().enumerate() {
            let (file_name, shown_path) = match source {
                Source::Path(p) => (paths::file_name(p), p.to_string_lossy().into_owned()),
                Source::Uri(u) => (external::picked_file_name(&app, u), u.clone()),
            };
            let _ = app.emit("import-progress", ImportProgress { job_id: job.clone(), index, total, file_name: file_name.clone() });
            let issue = |message: String, existing_id: Option<String>| ImportIssue {
                file_name: file_name.clone(),
                path: shown_path.clone(),
                message,
                existing_id,
            };
            // URIs are copied straight into the library folder; that copy is the stored file.
            let staged = match source {
                Source::Path(p) => Ok((p.clone(), false)),
                Source::Uri(u) => external::stage_input(&app, u, &library_dir, true).map(|p| (p, true)),
            };
            let (file, is_staged) = match staged {
                Ok(v) => v,
                Err(e) => {
                    report.errors.push(issue(e.to_string(), None));
                    continue;
                }
            };
            // A staged copy already lives in the library folder: never copy it a second time.
            // (Comparing paths for this is unreliable on Android, where the app folder has two names.)
            let no_copy = ImportOptions { copy_to: None };
            let result = {
                let mut conn = db.conn();
                import_one(&mut conn, &covers_dir, &file, if is_staged { &no_copy } else { &opts })
            };
            if is_staged && matches!(result, Ok(ImportOutcome::Duplicate(_)) | Err(_)) {
                let _ = std::fs::remove_file(&file); // nothing points at this copy
            }
            match result {
                Ok(ImportOutcome::Imported { id, pdf_pending }) => {
                    if pdf_pending {
                        report.pdf_pending.push(id.clone());
                    }
                    report.imported.push(id);
                }
                Ok(ImportOutcome::Relinked(id)) => report.relinked.push(id),
                Ok(ImportOutcome::Duplicate(id)) => {
                    report.duplicates.push(issue("Already in your library".into(), Some(id)))
                }
                Err(e) => report.errors.push(issue(e.to_string(), None)),
            }
        }
        if let Some(cid) = collection_id {
            let conn = db.conn();
            for id in report.imported.iter().chain(report.relinked.iter()) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO document_collections (document_id, collection_id, added_at) VALUES (?1, ?2, ?3)",
                    params![id, cid, now_ms()],
                );
            }
        }
        let _ = app.emit("import-complete", report);
    });

    Ok(ImportJob { job_id, total })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMeta {
    pub title: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub published: Option<String>,
    pub page_count: i64,
}

/// Called by the frontend after pdf.js has parsed a newly imported PDF.
#[tauri::command]
pub fn finalize_pdf_import(state: State<AppState>, id: String, meta: PdfMeta, cover_jpeg: Option<Vec<u8>>) -> AppResult<Document> {
    let conn = state.db.conn();
    let (title, file_name): (String, String) =
        conn.query_row("SELECT title, file_name FROM documents WHERE id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    // Only replace the title if the user has not edited it (it still equals the filename-derived title).
    let auto_title = paths::file_stem_title(Path::new(&file_name));
    let new_title = match dp::clean_meta(meta.title) {
        Some(t) if title == auto_title && t.len() > 2 && !t.to_ascii_lowercase().starts_with("untitled") && !t.to_ascii_lowercase().ends_with(".doc") => t,
        _ => title,
    };
    let cover_file = match cover_jpeg {
        Some(bytes) => cover::save_cover(&bytes, &state.covers_dir, &id)
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())),
        None => None,
    };
    conn.execute(
        "UPDATE documents SET title = ?1, author = coalesce(author, ?2), description = coalesce(description, ?3),
            published = coalesce(published, ?4), page_count = ?5, cover_path = coalesce(cover_path, ?6),
            metadata_ready = 1, updated_at = ?7 WHERE id = ?8",
        params![new_title, dp::clean_meta(meta.author), dp::clean_meta(meta.description), dp::clean_meta(meta.published), meta.page_count, cover_file, now_ms(), id],
    )?;
    get_doc(&conn, &id)
}

/// Store extracted text for full-text search. Sent in batches by the frontend.
#[tauri::command]
pub fn index_document_text(state: State<AppState>, id: String, chunks: Vec<TextChunk>, reset: bool, done: bool) -> AppResult<()> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    if reset {
        tx.execute("DELETE FROM doc_text WHERE document_id = ?1", [&id])?;
    }
    {
        let mut stmt = tx.prepare("INSERT INTO doc_text (document_id, locator, label, text) VALUES (?1, ?2, ?3, ?4)")?;
        for c in chunks.iter().filter(|c| !c.text.trim().is_empty()) {
            stmt.execute(params![id, c.locator, c.label, c.text])?;
        }
    }
    if done {
        tx.execute("UPDATE documents SET text_indexed = 1 WHERE id = ?1", [&id])?;
    }
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const STATUSES: &[&str] = &["unread", "reading", "completed", "on_hold", "abandoned"];

#[tauri::command]
pub fn update_documents(state: State<AppState>, ids: Vec<String>, patch: DocumentPatch) -> AppResult<Vec<Document>> {
    if let Some(s) = &patch.status {
        if !STATUSES.contains(&s.as_str()) {
            return Err(AppError::Invalid(format!("Unknown status {s}")));
        }
    }
    if let Some(t) = &patch.title {
        if t.trim().is_empty() {
            return Err(AppError::Invalid("Title cannot be empty".into()));
        }
    }
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    let now = now_ms();
    let opt = |v: &Option<String>| v.as_ref().map(|s| s.trim().to_string()).map(|s| if s.is_empty() { None } else { Some(s) });
    for id in &ids {
        if let Some(t) = &patch.title {
            tx.execute("UPDATE documents SET title = ?1 WHERE id = ?2", params![t.trim(), id])?;
        }
        for (col, val) in [
            ("author", opt(&patch.author)),
            ("description", opt(&patch.description)),
            ("publisher", opt(&patch.publisher)),
            ("published", opt(&patch.published)),
            ("language", opt(&patch.language)),
        ] {
            if let Some(v) = val {
                tx.execute(&format!("UPDATE documents SET {col} = ?1 WHERE id = ?2"), params![v, id])?;
            }
        }
        if let Some(s) = &patch.status {
            tx.execute("UPDATE documents SET status = ?1 WHERE id = ?2", params![s, id])?;
            if s == "completed" {
                tx.execute("UPDATE documents SET progress = 1 WHERE id = ?1", [id])?;
            }
        }
        if let Some(f) = patch.favorite {
            tx.execute("UPDATE documents SET favorite = ?1 WHERE id = ?2", params![f as i64, id])?;
        }
        tx.execute("UPDATE documents SET updated_at = ?1 WHERE id = ?2", params![now, id])?;
    }
    tx.commit()?;
    ids.iter().map(|id| get_doc(&conn, id)).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveReport {
    pub removed: usize,
    pub trashed: usize,
    pub failed: Vec<String>,
}

/// Remove documents from the library. Original files are only touched when
/// `delete_files` is explicitly true, and even then go to the recycle bin.
#[tauri::command]
pub fn remove_documents(state: State<AppState>, ids: Vec<String>, delete_files: bool) -> AppResult<RemoveReport> {
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    let mut targets = Vec::new();
    for id in &ids {
        let row: Option<(String, Option<String>)> = tx
            .query_row("SELECT path, cover_path FROM documents WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        if let Some(r) = row {
            tx.execute("DELETE FROM documents WHERE id = ?1", [id])?;
            targets.push(r);
        }
    }
    tx.commit()?;
    drop(conn);

    let mut report = RemoveReport { removed: targets.len(), trashed: 0, failed: vec![] };
    for (path, cover) in targets {
        if let Some(c) = cover {
            let _ = std::fs::remove_file(state.covers_dir.join(c));
        }
        if delete_files && Path::new(&path).exists() {
            match delete_file(&state, &path) {
                Ok(_) => report.trashed += 1,
                Err(e) => report.failed.push(format!("{path}: {e}")),
            }
        }
    }
    Ok(report)
}

/// Desktop: move to the recycle bin. Mobile has no recycle bin, and the app only
/// owns the copies inside its own storage, so those are deleted outright.
#[cfg(desktop)]
fn delete_file(_state: &AppState, path: &str) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

#[cfg(mobile)]
fn delete_file(state: &AppState, path: &str) -> Result<(), String> {
    // Canonicalise both sides: Android reaches the app folder as /data/user/0/… and /data/data/….
    let inside = match (std::fs::canonicalize(path), std::fs::canonicalize(&state.data_dir)) {
        (Ok(p), Ok(d)) => p.starts_with(d),
        _ => false,
    };
    if !inside {
        return Err("Only files stored by BookShelf can be deleted".into());
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

fn set_cover_bytes(state: &AppState, id: &str, bytes: &[u8]) -> AppResult<Document> {
    let file = cover::save_cover(bytes, &state.covers_dir, id)?;
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned());
    let conn = state.db.conn();
    conn.execute("UPDATE documents SET cover_path = ?1, updated_at = ?2 WHERE id = ?3", params![name, now_ms(), id])?;
    get_doc(&conn, id)
}

#[tauri::command]
pub fn set_cover_from_file(app: AppHandle, state: State<AppState>, id: String, path: String) -> AppResult<Document> {
    if external::is_uri(&path) {
        // Android: copy the picked image in; the decoder rejects anything that isn't one.
        let local = external::stage_input(&app, &path, &state.temp_dir(), false)?;
        let bytes = std::fs::read(&local);
        let _ = std::fs::remove_file(&local);
        return set_cover_bytes(&state, &id, &bytes?);
    }
    let p = PathBuf::from(&path);
    if !cover::is_image_name(&path) || !p.is_file() {
        return Err(AppError::Invalid("Please choose a JPG, PNG, WebP, GIF or BMP image".into()));
    }
    let bytes = std::fs::read(&p)?;
    set_cover_bytes(&state, &id, &bytes)
}

#[tauri::command]
pub fn set_cover_image(state: State<AppState>, id: String, bytes: Vec<u8>) -> AppResult<Document> {
    set_cover_bytes(&state, &id, &bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkResult {
    pub document: Option<Document>,
    pub hash_matches: bool,
}

#[tauri::command]
pub fn relink_document(app: AppHandle, state: State<AppState>, id: String, path: String, force: bool) -> AppResult<RelinkResult> {
    if external::is_uri(&path) {
        // Android: bring the file into app storage, then relink to that copy.
        let local = external::stage_input(&app, &path, &state.library_dir(), true)?;
        let result = relink_document(app, state, id, local.to_string_lossy().into_owned(), force);
        if !matches!(result, Ok(RelinkResult { document: Some(_), .. })) {
            let _ = std::fs::remove_file(&local);
        }
        return result;
    }
    let (p, format) = paths::validate_document_path(&path)?;
    let digest = hash::file_hash(&p)?;
    let conn = state.db.conn();
    let (old_hash, old_format): (String, String) =
        conn.query_row("SELECT hash, format FROM documents WHERE id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if old_format != format.as_str() {
        return Err(AppError::Invalid(format!("Expected a .{old_format} file")));
    }
    let matches = old_hash == digest;
    if !matches && !force {
        return Ok(RelinkResult { document: None, hash_matches: false });
    }
    if !matches {
        let taken: Option<String> = conn.query_row("SELECT id FROM documents WHERE hash = ?1", [&digest], |r| r.get(0)).optional()?;
        if taken.is_some() {
            return Err(AppError::Invalid("That file is already in your library as another document".into()));
        }
    }
    conn.execute(
        "UPDATE documents SET path = ?1, hash = ?2, missing = 0, file_size = ?3, updated_at = ?4 WHERE id = ?5",
        params![p.to_string_lossy(), digest, std::fs::metadata(&p)?.len() as i64, now_ms(), id],
    )?;
    Ok(RelinkResult { document: Some(get_doc(&conn, &id)?), hash_matches: matches })
}

/// Re-check every document path and flag missing files.
#[tauri::command]
pub fn check_missing_files(state: State<AppState>) -> AppResult<usize> {
    let conn = state.db.conn();
    let rows: Vec<(String, String, i64)> = conn
        .prepare("SELECT id, path, missing FROM documents")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    drop(conn);
    let mut missing = 0;
    let mut changes = Vec::new();
    for (id, path, was) in rows {
        let now_missing = !Path::new(&path).is_file();
        if now_missing {
            missing += 1;
        }
        if now_missing as i64 != was {
            changes.push((id, now_missing));
        }
    }
    let conn = state.db.conn();
    for (id, m) in changes {
        conn.execute("UPDATE documents SET missing = ?1 WHERE id = ?2", params![m as i64, id])?;
    }
    Ok(missing)
}

#[tauri::command]
pub fn reveal_document(app: AppHandle, state: State<AppState>, id: String) -> AppResult<()> {
    let path: String = state.db.conn().query_row("SELECT path FROM documents WHERE id = ?1", [&id], |r| r.get(0))?;
    if !Path::new(&path).exists() {
        return Err(AppError::NotFound("The file no longer exists at its saved location".into()));
    }
    #[cfg(desktop)]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener().reveal_item_in_dir(&path).map_err(|e| AppError::Other(e.to_string()))
    }
    #[cfg(mobile)]
    {
        let _ = app;
        Err(AppError::Invalid("Showing files in a folder isn't available on this device".into()))
    }
}

#[tauri::command]
pub fn read_text_document(state: State<AppState>, id: String) -> AppResult<String> {
    let path: String = state.db.conn().query_row("SELECT path FROM documents WHERE id = ?1", [&id], |r| r.get(0))?;
    dp::text::read_text(Path::new(&path))
}

#[tauri::command]
pub fn get_app_data_dir(app: AppHandle) -> AppResult<String> {
    Ok(app.path().app_data_dir().map_err(|e| AppError::Other(e.to_string()))?.to_string_lossy().into_owned())
}
