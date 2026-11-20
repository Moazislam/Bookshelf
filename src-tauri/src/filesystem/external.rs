//! Files that live outside the app, addressed by a URI instead of a path.
//!
//! On Android the system file picker and save dialog hand back `content://`
//! URIs, which `std::fs` cannot open. These helpers copy such files into app
//! storage (inputs) or copy a finished local file out to them (outputs), so the
//! rest of the backend only ever deals with ordinary paths. On desktop the
//! dialogs return plain paths and none of this is used.

use crate::document_processing::Format;
use crate::error::{AppError, AppResult, new_id};
use crate::filesystem::paths;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

/// True for `content://…`, `file://…` and similar picker results.
pub fn is_uri(raw: &str) -> bool {
    raw.contains("://")
}

fn open_uri<R: Runtime>(app: &AppHandle<R>, raw: &str, write: bool) -> AppResult<std::fs::File> {
    let target: FilePath = raw.parse().map_err(|_| AppError::Invalid(format!("Not a valid file location: {raw}")))?;
    let mut opts = OpenOptions::new();
    if write {
        opts.write(true).create(true).truncate(true);
    } else {
        opts.read(true);
    }
    app.fs().open(target, opts).map_err(|e| AppError::Other(format!("Could not open the selected file: {e}")))
}

/// Best-effort file name from a URI's last segment, e.g.
/// `content://…/document/primary%3ADownload%2Fbook.epub` → `book.epub`.
pub fn uri_file_name(raw: &str) -> String {
    let decoded = percent_encoding::percent_decode_str(raw).decode_utf8_lossy().into_owned();
    let trimmed = decoded.trim_end_matches('/');
    clean_file_name(trimmed.rsplit(['/', ':']).next().unwrap_or(""))
}

/// Keep a name usable as a single file name on any platform.
fn clean_file_name(name: &str) -> String {
    let clean: String = name.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*' | '\0')).collect();
    let clean = clean.trim().trim_start_matches('.').to_string();
    if clean.is_empty() { "document".into() } else { clean }
}

/// The name of a picked file: on Android the real name from the file provider
/// ("Atomic Habits.pdf"), since the URI itself often only carries a numeric id.
pub fn picked_file_name<R: Runtime>(app: &AppHandle<R>, raw: &str) -> String {
    #[cfg(target_os = "android")]
    if let Some(name) = crate::android::display_name(app, raw) {
        return clean_file_name(&name);
    }
    let _ = app;
    uri_file_name(raw)
}

/// Recognise a document from its first bytes when the name has no extension.
pub fn sniff_format(path: &Path) -> Option<&'static str> {
    let mut head = [0u8; 512];
    let n = std::fs::File::open(path).ok()?.read(&mut head).ok()?;
    let head = &head[..n];
    if head.starts_with(b"%PDF") {
        return Some("pdf");
    }
    if head.starts_with(b"PK\x03\x04") {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
        return Some(if zip.by_name("META-INF/container.xml").is_ok() { "epub" } else { "cbz" });
    }
    let valid = match std::str::from_utf8(head) {
        Ok(_) => true,
        Err(e) => e.error_len().is_none(), // only a multi-byte char cut off at the end
    };
    (n > 0 && valid && !head.contains(&0)).then_some("txt")
}

/// Copy a picked file into `dir` and return the local copy. Plain paths are
/// returned unchanged. When `documents_only` is set, the copy is given a
/// recognised document extension (sniffed if needed) or rejected.
pub fn stage_input<R: Runtime>(app: &AppHandle<R>, raw: &str, dir: &Path, documents_only: bool) -> AppResult<PathBuf> {
    if !is_uri(raw) {
        return Ok(PathBuf::from(raw));
    }
    std::fs::create_dir_all(dir)?;
    let name = picked_file_name(app, raw);
    let tmp = dir.join(format!(".{}.partial", new_id()));
    let copied = (|| -> AppResult<()> {
        let mut src = open_uri(app, raw, false)?;
        let mut dst = std::fs::File::create(&tmp)?;
        std::io::copy(&mut src, &mut dst)?;
        Ok(())
    })();
    if let Err(e) = copied {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    let mut final_name = name.clone();
    if documents_only && Format::from_path(Path::new(&name)).is_none() {
        match sniff_format(&tmp) {
            Some(ext) => final_name = format!("{name}.{ext}"),
            None => {
                let _ = std::fs::remove_file(&tmp);
                return Err(AppError::Invalid(format!("Unsupported file type: {name}")));
            }
        }
    }
    let dest = paths::unique_destination(dir, &final_name);
    std::fs::rename(&tmp, &dest)?;
    Ok(dest)
}

/// Where a command should write its output: the path itself, or a temp file
/// that `finish_output` copies to the URI afterwards.
pub fn output_target(raw: &str, temp_dir: &Path, ext: &str) -> AppResult<PathBuf> {
    if !is_uri(raw) {
        return Ok(PathBuf::from(raw));
    }
    std::fs::create_dir_all(temp_dir)?;
    Ok(temp_dir.join(format!("export-{}.{ext}", new_id())))
}

/// Copy a finished temp file out to the URI the user picked, then remove it.
pub fn finish_output<R: Runtime>(app: &AppHandle<R>, raw: &str, local: &Path) -> AppResult<()> {
    if !is_uri(raw) {
        return Ok(());
    }
    let result = (|| -> AppResult<()> {
        let mut src = std::fs::File::open(local)?;
        let mut dst = open_uri(app, raw, true)?;
        std::io::copy(&mut src, &mut dst)?;
        dst.sync_all().ok();
        Ok(())
    })();
    let _ = std::fs::remove_file(local);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_android_uris() {
        assert_eq!(uri_file_name("content://com.android.externalstorage.documents/document/primary%3ADownload%2FMy%20Book.epub"), "My Book.epub");
        assert_eq!(uri_file_name("content://com.android.providers.downloads.documents/document/msf%3A1234"), "1234");
        assert_eq!(uri_file_name("content://x/"), "x");
    }

    #[test]
    fn provider_names_cannot_escape_the_folder() {
        assert_eq!(clean_file_name("Atomic Habits.pdf"), "Atomic Habits.pdf");
        assert_eq!(clean_file_name("../../evil.pdf"), "evil.pdf");
        assert_eq!(clean_file_name("a\\b:c.epub"), "abc.epub");
        assert_eq!(clean_file_name("   "), "document");
    }

    #[test]
    fn sniffs_formats() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("a");
        std::fs::write(&pdf, b"%PDF-1.7\n...").unwrap();
        assert_eq!(sniff_format(&pdf), Some("pdf"));
        let txt = dir.path().join("b");
        std::fs::write(&txt, "Hello, wörld").unwrap();
        assert_eq!(sniff_format(&txt), Some("txt"));
        let bin = dir.path().join("c");
        std::fs::write(&bin, [0u8, 159, 146, 150]).unwrap();
        assert_eq!(sniff_format(&bin), None);
    }

    #[test]
    fn plain_paths_pass_through() {
        assert!(!is_uri(r"C:\Books\a.pdf"));
        assert!(is_uri("content://a/b"));
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(output_target("/tmp/x.zip", dir.path(), "zip").unwrap(), PathBuf::from("/tmp/x.zip"));
    }
}
