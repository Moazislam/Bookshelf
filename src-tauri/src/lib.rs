#[cfg(target_os = "android")]
mod android;
mod commands;
mod database;
mod document_processing;
mod error;
mod filesystem;
mod models;
mod state;

#[cfg(test)]
mod tests;

use commands::{annotations, collections, documents, reading, search, settings, stats};
use database::Db;
use state::AppState;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(android::init());

    builder
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            // Leftovers from an interrupted import or export.
            let _ = std::fs::remove_dir_all(data_dir.join("tmp"));
            let covers_dir = data_dir.join("covers");
            std::fs::create_dir_all(&covers_dir)?;
            // Clean up temporary files left behind by an interrupted run.
            for entry in std::fs::read_dir(&covers_dir)?.flatten() {
                if entry.path().extension().is_some_and(|e| e == "tmp") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
            let db = Db::open(&data_dir.join("library.db")).map_err(|e| format!("Could not open the library database: {e}"))?;
            app.manage(AppState { db: Arc::new(db), data_dir, covers_dir });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("bookfile", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let state = app.state::<AppState>();
                responder.respond(filesystem::protocol::handle(&state, &request));
            });
        })
        .invoke_handler(tauri::generate_handler![
            documents::list_documents,
            documents::get_document,
            documents::import_paths,
            documents::finalize_pdf_import,
            documents::index_document_text,
            documents::update_documents,
            documents::remove_documents,
            documents::set_cover_from_file,
            documents::set_cover_image,
            documents::relink_document,
            documents::check_missing_files,
            documents::reveal_document,
            documents::read_text_document,
            documents::get_app_data_dir,
            collections::list_collections,
            collections::create_collection,
            collections::update_collection,
            collections::delete_collection,
            collections::set_document_collections,
            collections::add_documents_to_collection,
            collections::remove_documents_from_collection,
            collections::list_tags,
            collections::create_tag,
            collections::update_tag,
            collections::delete_tag,
            collections::set_document_tags,
            collections::add_tag_to_documents,
            collections::set_note_tags,
            annotations::list_highlights,
            annotations::create_highlight,
            annotations::update_highlight,
            annotations::delete_highlight,
            annotations::list_bookmarks,
            annotations::create_bookmark,
            annotations::update_bookmark,
            annotations::delete_bookmark,
            annotations::list_notes,
            annotations::create_note,
            annotations::update_note,
            annotations::delete_note,
            reading::get_reading_position,
            reading::save_reading_position,
            reading::mark_document_opened,
            reading::record_reading_session,
            reading::cache_get,
            reading::cache_set,
            search::search,
            search::search_in_document,
            stats::get_stats,
            stats::reading_history,
            settings::get_settings,
            settings::set_setting,
            settings::library_info,
            settings::write_export,
            settings::create_backup,
            settings::restore_backup,
            settings::run_maintenance,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BookShelf");
}
