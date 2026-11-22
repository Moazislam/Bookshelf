//! Integration tests for the data layer: migrations, import/dedupe and the
//! guarantees around never deleting documents implicitly.

use crate::commands::collections::{creates_cycle, delete_collection_inner};
use crate::commands::documents::{ImportOptions, ImportOutcome, get_doc, import_one, index_document_text_inner};
use crate::models::TextChunk;
use crate::commands::search::search_inner;
use crate::database::Db;
use crate::error::now_ms;
use rusqlite::params;
use std::io::Write;

fn write_file(dir: &std::path::Path, name: &str, body: &str) -> std::path::PathBuf {
    let p = dir.join(name);
    std::fs::File::create(&p).unwrap().write_all(body.as_bytes()).unwrap();
    p
}

fn no_copy() -> ImportOptions {
    ImportOptions { copy_to: None }
}

#[test]
fn migrations_apply_and_are_idempotent() {
    let db = Db::open_in_memory().unwrap();
    let mut conn = db.conn();
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, crate::database::migrations::latest_version());
    crate::database::migrations::run(&mut conn).unwrap();
    let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(fk, 1);
}

#[test]
fn import_markdown_and_detect_duplicates() {
    let dir = tempfile::tempdir().unwrap();
    let covers = dir.path().join("covers");
    let md = write_file(dir.path(), "notes.md", "# Deep Work\n\nFocus is a superpower.\n");
    let db = Db::open_in_memory().unwrap();
    let mut conn = db.conn();

    let id = match import_one(&mut conn, &covers, &md, &no_copy()).unwrap() {
        ImportOutcome::Imported { id, pdf_pending, .. } => {
            assert!(!pdf_pending);
            id
        }
        _ => panic!("expected import"),
    };
    let doc = get_doc(&conn, &id).unwrap();
    assert_eq!(doc.title, "Deep Work");
    assert_eq!(doc.format, "md");
    assert!(doc.text_indexed);

    // Same content under another name is a duplicate.
    let copy = write_file(dir.path(), "copy.md", "# Deep Work\n\nFocus is a superpower.\n");
    assert!(matches!(import_one(&mut conn, &covers, &copy, &no_copy()).unwrap(), ImportOutcome::Duplicate(d) if d == id));

    // Full-text search finds the body text.
    let results = search_inner(&conn, "superpow", 10).unwrap();
    assert_eq!(results.content.len(), 1);
    assert_eq!(results.content[0].document_id, id);
    assert!(results.content[0].snippet.contains('\u{1}'));
}

#[test]
fn moved_file_is_relinked_on_reimport() {
    let dir = tempfile::tempdir().unwrap();
    let covers = dir.path().join("covers");
    let a = write_file(dir.path(), "a.txt", "hello moved world");
    let db = Db::open_in_memory().unwrap();
    let mut conn = db.conn();
    let ImportOutcome::Imported { id, .. } = import_one(&mut conn, &covers, &a, &no_copy()).unwrap() else { panic!() };
    let b = dir.path().join("b.txt");
    std::fs::rename(&a, &b).unwrap();
    assert!(matches!(import_one(&mut conn, &covers, &b, &no_copy()).unwrap(), ImportOutcome::Relinked(r) if r == id));
    assert!(get_doc(&conn, &id).unwrap().path.ends_with("b.txt"));
}

#[test]
fn rejects_unsupported_and_empty_files() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open_in_memory().unwrap();
    let mut conn = db.conn();
    let exe = write_file(dir.path(), "x.exe", "MZ");
    assert!(import_one(&mut conn, dir.path(), &exe, &no_copy()).is_err());
    let empty = write_file(dir.path(), "e.txt", "");
    assert!(import_one(&mut conn, dir.path(), &empty, &no_copy()).is_err());
}

#[test]
fn copy_on_import_copies_into_library_folder() {
    let dir = tempfile::tempdir().unwrap();
    let lib = dir.path().join("Library");
    let src = write_file(dir.path(), "book.txt", "some text");
    let db = Db::open_in_memory().unwrap();
    let mut conn = db.conn();
    let ImportOutcome::Imported { id, .. } =
        import_one(&mut conn, &dir.path().join("covers"), &src, &ImportOptions { copy_to: Some(lib.clone()) }).unwrap()
    else {
        panic!()
    };
    let doc = get_doc(&conn, &id).unwrap();
    assert!(std::path::Path::new(&doc.path).starts_with(&lib));
    assert!(src.exists(), "original must be left untouched");
}

#[test]
fn maintenance_removes_only_unreferenced_stored_copies() {
    let dir = tempfile::tempdir().unwrap();
    let state = crate::state::AppState {
        db: std::sync::Arc::new(Db::open_in_memory().unwrap()),
        data_dir: dir.path().to_path_buf(),
        covers_dir: dir.path().join("covers"),
    };
    let lib = state.library_dir();
    std::fs::create_dir_all(&lib).unwrap();
    let used = write_file(&lib, "book (1).txt", "kept, a document points here");
    let orphan = write_file(&lib, "book.txt", "leftover copy");
    let outside = write_file(dir.path(), "elsewhere.txt", "never touched");
    {
        let mut conn = state.db.conn();
        import_one(&mut conn, &state.covers_dir, &used, &no_copy()).unwrap();
    }
    assert_eq!(crate::commands::settings::remove_orphan_library_files(&state).unwrap(), 1);
    assert!(used.exists());
    assert!(!orphan.exists());
    assert!(outside.exists());
}

fn seed_doc(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT INTO documents (id, path, hash, format, file_name, title, added_at, updated_at) VALUES (?1, 'C:/x', ?1, 'pdf', 'x.pdf', 'X', ?2, ?2)",
        params![id, now_ms()],
    )
    .unwrap();
}

#[test]
fn deleting_collection_keeps_documents_and_reparents_children() {
    let db = Db::open_in_memory().unwrap();
    let mut conn = db.conn();
    seed_doc(&conn, "d1");
    conn.execute_batch(
        "INSERT INTO collections (id, parent_id, name, created_at) VALUES ('root', NULL, 'Root', 0);
         INSERT INTO collections (id, parent_id, name, created_at) VALUES ('mid', 'root', 'Mid', 0);
         INSERT INTO collections (id, parent_id, name, created_at) VALUES ('leaf', 'mid', 'Leaf', 0);
         INSERT INTO document_collections VALUES ('d1', 'mid', 0);",
    )
    .unwrap();
    assert!(creates_cycle(&conn, "root", "leaf").unwrap());
    assert!(!creates_cycle(&conn, "leaf", "root").unwrap());

    delete_collection_inner(&mut conn, "mid").unwrap();
    let docs: i64 = conn.query_row("SELECT count(*) FROM documents", [], |r| r.get(0)).unwrap();
    assert_eq!(docs, 1);
    let parent: Option<String> = conn.query_row("SELECT parent_id FROM collections WHERE id='leaf'", [], |r| r.get(0)).unwrap();
    assert_eq!(parent.as_deref(), Some("root"));
    let links: i64 = conn.query_row("SELECT count(*) FROM document_collections", [], |r| r.get(0)).unwrap();
    assert_eq!(links, 0);
}

#[test]
fn removing_document_cascades_annotations_but_keeps_notes() {
    let db = Db::open_in_memory().unwrap();
    let conn = db.conn();
    seed_doc(&conn, "d1");
    conn.execute_batch(
        "INSERT INTO highlights (id, document_id, locator, anchor, text, created_at, updated_at) VALUES ('h1','d1','1','{}','quote',0,0);
         INSERT INTO notes (id, document_id, highlight_id, title, body, created_at, updated_at) VALUES ('n1','d1','h1','t','body',0,0);
         INSERT INTO bookmarks (id, document_id, locator, label, created_at) VALUES ('b1','d1','1','p1',0);",
    )
    .unwrap();
    conn.execute("DELETE FROM documents WHERE id='d1'", []).unwrap();
    let hl: i64 = conn.query_row("SELECT count(*) FROM highlights", [], |r| r.get(0)).unwrap();
    let bm: i64 = conn.query_row("SELECT count(*) FROM bookmarks", [], |r| r.get(0)).unwrap();
    let (doc, hid): (Option<String>, Option<String>) =
        conn.query_row("SELECT document_id, highlight_id FROM notes WHERE id='n1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((hl, bm), (0, 0));
    assert_eq!((doc, hid), (None, None), "notes survive as standalone notes");
}

#[test]
fn stats_activity_has_one_row_per_day() {
    let db = Db::open_in_memory().unwrap();
    let conn = db.conn();
    seed_doc(&conn, "d1");
    let now = now_ms();
    conn.execute(
        "INSERT INTO reading_sessions (document_id, started_at, ended_at, active_seconds, pages_read) VALUES ('d1', ?1, ?1, 120, 4)",
        [now],
    )
    .unwrap();
    let days = crate::commands::stats::activity(&conn, 7).unwrap();
    assert_eq!(days.len(), 7);
    assert_eq!(days.last().unwrap().seconds, 120);
    let t = crate::commands::stats::totals(&conn);
    assert_eq!((t.pages_read, t.reading_seconds), (4, 120));
}

#[test]
fn scanned_pdf_is_flagged_and_becomes_searchable_after_ocr() {
    let dir = tempfile::tempdir().unwrap();
    let covers = dir.path().join("covers");
    let pdf = write_file(dir.path(), "scan.pdf", "%PDF-1.4 scanned pages only");
    let db = Db::open_in_memory().unwrap();
    let mut conn = db.conn();
    let ImportOutcome::Imported { id, pdf_pending, .. } = import_one(&mut conn, &covers, &pdf, &no_copy()).unwrap() else { panic!() };
    assert!(pdf_pending);
    assert_eq!(get_doc(&conn, &id).unwrap().text_source, None);

    // pdf.js found no text on any page.
    index_document_text_inner(&mut conn, &id, &[], true, true, None).unwrap();
    let doc = get_doc(&conn, &id).unwrap();
    assert!(doc.text_indexed);
    assert_eq!(doc.text_source.as_deref(), Some("none"));

    // OCR results replace the empty index.
    let page = |n: &str, text: &str| TextChunk { locator: n.into(), label: Some(format!("Page {n}")), text: text.into() };
    index_document_text_inner(&mut conn, &id, &[page("1", "The quick brown fox")], true, false, Some(true)).unwrap();
    index_document_text_inner(&mut conn, &id, &[page("2", "jumps over the lazy dog")], false, true, Some(true)).unwrap();
    assert_eq!(get_doc(&conn, &id).unwrap().text_source.as_deref(), Some("ocr"));
    let results = search_inner(&conn, "lazy", 10).unwrap();
    assert_eq!(results.content.len(), 1);
    assert_eq!(results.content[0].locator, "2");

    // Text files get their source at import time.
    let txt = write_file(dir.path(), "a.txt", "plain words");
    let ImportOutcome::Imported { id: tid, .. } = import_one(&mut conn, &covers, &txt, &no_copy()).unwrap() else { panic!() };
    assert_eq!(get_doc(&conn, &tid).unwrap().text_source.as_deref(), Some("native"));
}

#[test]
fn corrupt_cover_is_reported_as_a_warning_not_swallowed() {
    let dir = tempfile::tempdir().unwrap();
    let covers = dir.path().join("covers");
    // Minimal EPUB whose declared cover image is not a real image.
    let epub = dir.path().join("broken-cover.epub");
    {
        let f = std::fs::File::create(&epub).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default();
        z.start_file("mimetype", opts).unwrap();
        z.write_all(b"application/epub+zip").unwrap();
        z.start_file("META-INF/container.xml", opts).unwrap();
        z.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
        z.start_file("OEBPS/content.opf", opts).unwrap();
        z.write_all(br#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Broken Cover</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="img" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest><spine><itemref idref="c1"/></spine></package>"#).unwrap();
        z.start_file("OEBPS/c1.xhtml", opts).unwrap();
        z.write_all(b"<html><body><p>Some real chapter text to index.</p></body></html>").unwrap();
        z.start_file("OEBPS/cover.jpg", opts).unwrap();
        z.write_all(b"this is not a jpeg").unwrap();
        z.finish().unwrap();
    }
    let db = Db::open_in_memory().unwrap();
    let mut conn = db.conn();
    let ImportOutcome::Imported { id, warning, .. } = import_one(&mut conn, &covers, &epub, &no_copy()).unwrap() else { panic!() };
    let doc = get_doc(&conn, &id).unwrap();
    assert_eq!(doc.title, "Broken Cover");
    assert!(!doc.has_cover, "no cover file should be stored for a corrupt image");
    let w = warning.expect("a corrupt cover must surface as a warning");
    assert!(w.contains("Cover image"), "unexpected warning: {w}");
}
