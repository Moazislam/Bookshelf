use crate::database::migrations;
use crate::error::{AppError, AppResult, now_ms};
use crate::filesystem::external;
use crate::filesystem::paths::validate_export_path;
use crate::state::AppState;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppResult<HashMap<String, serde_json::Value>> {
    let conn = state.db.conn();
    let rows: Vec<(String, String)> = conn
        .prepare("SELECT key, value FROM settings")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows.into_iter().filter_map(|(k, v)| serde_json::from_str(&v).ok().map(|v| (k, v))).collect())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: serde_json::Value) -> AppResult<()> {
    if key.len() > 100 {
        return Err(AppError::Invalid("Setting key too long".into()));
    }
    if key == "library.folder" {
        if let Some(p) = value.as_str() {
            if !Path::new(p).is_absolute() {
                return Err(AppError::Invalid("Library folder must be an absolute path".into()));
            }
        }
    }
    state.db.conn().execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, serde_json::to_string(&value)?],
    )?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub data_dir: String,
    pub database_path: String,
    pub database_size: u64,
    pub covers_size: u64,
    pub schema_version: i64,
}

fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum()
}

#[tauri::command]
pub fn library_info(state: State<AppState>) -> AppResult<LibraryInfo> {
    let db_size = ["", "-wal"]
        .iter()
        .filter_map(|s| std::fs::metadata(format!("{}{s}", state.db.path.to_string_lossy())).ok())
        .map(|m| m.len())
        .sum();
    Ok(LibraryInfo {
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        database_path: state.db.path.to_string_lossy().into_owned(),
        database_size: db_size,
        covers_size: dir_size(&state.covers_dir),
        schema_version: migrations::latest_version(),
    })
}

/// Write an export (notes / highlights) to a path the user picked in a save dialog.
#[tauri::command]
pub fn write_export(app: AppHandle, state: State<AppState>, path: String, contents: String) -> AppResult<()> {
    if external::is_uri(&path) {
        // Android save dialogs return a content:// URI the user already chose a name for.
        let local = external::output_target(&path, &state.temp_dir(), "txt")?;
        std::fs::write(&local, contents)?;
        return external::finish_output(&app, &path, &local);
    }
    let p = validate_export_path(&path, &["md", "markdown", "txt", "json", "csv"])?;
    let tmp = p.with_extension("partial");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

/// Backup = consistent DB snapshot (VACUUM INTO) + cover thumbnails, zipped.
#[tauri::command]
pub fn create_backup(app: AppHandle, state: State<AppState>, path: String) -> AppResult<u64> {
    let dest = if external::is_uri(&path) {
        external::output_target(&path, &state.temp_dir(), "zip")?
    } else {
        validate_export_path(&path, &["zip"])?
    };
    let snapshot = state.data_dir.join(format!("backup-{}.db", now_ms()));
    {
        let conn = state.db.conn();
        conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy()])?;
    }
    let result = (|| -> AppResult<()> {
        let file = std::fs::File::create(&dest)?;
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("library.db", opts)?;
        zip.write_all(&std::fs::read(&snapshot)?)?;
        let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for entry in std::fs::read_dir(&state.covers_dir).into_iter().flatten().flatten() {
            let p = entry.path();
            if p.is_file() {
                zip.start_file(format!("covers/{}", entry.file_name().to_string_lossy()), stored)?;
                zip.write_all(&std::fs::read(&p)?)?;
            }
        }
        zip.start_file("manifest.json", opts)?;
        zip.write_all(
            serde_json::json!({ "app": "BookShelf", "schema": migrations::latest_version(), "createdAt": now_ms() })
                .to_string()
                .as_bytes(),
        )?;
        zip.finish()?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&snapshot);
    if let Err(e) = result {
        if external::is_uri(&path) {
            let _ = std::fs::remove_file(&dest);
        }
        return Err(e);
    }
    let size = std::fs::metadata(&dest)?.len();
    external::finish_output(&app, &path, &dest)?;
    Ok(size)
}

/// Restore a backup in place. The current database is first saved next to it
/// as `library.before-restore.db`, so a restore can always be undone manually.
#[tauri::command]
pub fn restore_backup(app: AppHandle, state: State<AppState>, path: String) -> AppResult<()> {
    if external::is_uri(&path) {
        let local = external::stage_input(&app, &path, &state.temp_dir(), false)?;
        let result = restore_from(&state, &local);
        let _ = std::fs::remove_file(&local);
        return result;
    }
    let src = validate_export_path(&path, &["zip"])?;
    restore_from(&state, &src)
}

fn restore_from(state: &AppState, src: &Path) -> AppResult<()> {
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(src)?))?;
    let staged = state.data_dir.join("restore-staging.db");
    {
        let mut entry = zip
            .by_name("library.db")
            .map_err(|_| AppError::Invalid("This file is not a BookShelf backup".into()))?;
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        std::fs::write(&staged, buf)?;
    }
    // Validate the staged DB before touching the live one.
    {
        let check = rusqlite::Connection::open(&staged)?;
        let version: i64 = check.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > migrations::latest_version() {
            let _ = std::fs::remove_file(&staged);
            return Err(AppError::Invalid("This backup was made by a newer version of BookShelf".into()));
        }
        let ok: String = check.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        if ok != "ok" {
            let _ = std::fs::remove_file(&staged);
            return Err(AppError::Invalid("The backup database is damaged".into()));
        }
    }
    {
        let mut conn = state.db.conn();
        let safety = state.data_dir.join("library.before-restore.db");
        let _ = std::fs::remove_file(&safety);
        conn.execute("VACUUM INTO ?1", [safety.to_string_lossy()])?;
        conn.restore(rusqlite::MAIN_DB, &staged, None::<fn(rusqlite::backup::Progress)>)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrations::run(&mut conn)?;
    }
    let _ = std::fs::remove_file(&staged);

    // Restore cover thumbnails.
    std::fs::create_dir_all(&state.covers_dir)?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        if let Some(file) = name.strip_prefix("covers/") {
            if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
                continue;
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            std::fs::write(state.covers_dir.join(file), buf)?;
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceReport {
    pub integrity: String,
    pub size_before: u64,
    pub size_after: u64,
    pub orphan_covers_removed: usize,
    pub orphan_files_removed: usize,
}

#[tauri::command]
pub fn run_maintenance(state: State<AppState>) -> AppResult<MaintenanceReport> {
    let size = || std::fs::metadata(&state.db.path).map(|m| m.len()).unwrap_or(0);
    let before = size();
    let conn = state.db.conn();
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    for t in ["doc_text", "documents_fts", "highlights_fts", "notes_fts"] {
        conn.execute(&format!("INSERT INTO {t}({t}) VALUES ('optimize')"), [])?;
    }
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA optimize;")?;
    let known: std::collections::HashSet<String> = conn
        .prepare("SELECT cover_path FROM documents WHERE cover_path IS NOT NULL")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    drop(conn);
    let mut removed = 0;
    for entry in std::fs::read_dir(&state.covers_dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !known.contains(&name) && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    let orphan_files_removed = remove_orphan_library_files(&state)?;
    Ok(MaintenanceReport { integrity, size_before: before, size_after: size(), orphan_covers_removed: removed, orphan_files_removed })
}

/// Delete stored copies in the app's own library folder (used on mobile) that no
/// document points to any more, e.g. leftovers from an interrupted import.
/// Only that folder is touched; files elsewhere are never deleted.
pub(crate) fn remove_orphan_library_files(state: &AppState) -> AppResult<usize> {
    let dir = state.library_dir();
    let Ok(canonical_dir) = std::fs::canonicalize(&dir) else { return Ok(0) };
    let known: std::collections::HashSet<std::path::PathBuf> = {
        let conn = state.db.conn();
        let paths: Vec<String> = conn.prepare("SELECT path FROM documents")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        paths.into_iter().filter_map(|p| std::fs::canonicalize(p).ok()).collect()
    };
    let mut removed = 0;
    for entry in std::fs::read_dir(&canonical_dir)?.flatten() {
        let p = entry.path();
        if p.is_file() && !known.contains(&p) && std::fs::remove_file(&p).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}
