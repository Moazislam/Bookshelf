use crate::document_processing::Format;
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Canonicalise and validate a path the frontend asked us to import or relink.
pub fn validate_document_path(raw: &str) -> AppResult<(PathBuf, Format)> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(AppError::Invalid(format!("Not an absolute path: {raw}")));
    }
    let canonical = dunce_canonicalize(path)?;
    let meta = std::fs::metadata(&canonical)?;
    if !meta.is_file() {
        return Err(AppError::Invalid(format!("Not a file: {raw}")));
    }
    if meta.len() == 0 {
        return Err(AppError::Invalid("File is empty".into()));
    }
    let format = Format::from_path(&canonical)
        .ok_or_else(|| AppError::Invalid(format!("Unsupported file type: {}", file_name(&canonical))))?;
    Ok((canonical, format))
}

/// Expand a mix of files and folders into a flat list of supported files.
pub fn expand_import_paths(raw: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for r in raw {
        let p = Path::new(r);
        if p.is_dir() {
            for entry in walkdir::WalkDir::new(p).follow_links(false).into_iter().flatten() {
                if entry.file_type().is_file() && Format::from_path(entry.path()).is_some() {
                    out.push(entry.into_path());
                }
            }
        } else {
            out.push(p.to_path_buf());
        }
    }
    out.sort();
    out.dedup();
    out
}

/// `std::fs::canonicalize` on Windows returns `\\?\` verbatim paths, which are
/// awkward to display and to compare. Strip the prefix when it is safe to.
pub fn dunce_canonicalize(p: &Path) -> AppResult<PathBuf> {
    let c = std::fs::canonicalize(p)?;
    #[cfg(windows)]
    {
        let s = c.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC\\") && rest.len() < 260 {
                return Ok(PathBuf::from(rest));
            }
        }
    }
    Ok(c)
}

pub fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

pub fn file_stem_title(p: &Path) -> String {
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let t = stem.replace(['_'], " ");
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() { "Untitled".into() } else { t }
}

/// Pick a non-colliding destination name inside `dir`.
pub fn unique_destination(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    for i in 1.. {
        let c = dir.join(format!("{stem} ({i}){ext}"));
        if !c.exists() {
            return c;
        }
    }
    unreachable!()
}

/// Only allow writing exports with known, harmless extensions.
pub fn validate_export_path(raw: &str, allowed: &[&str]) -> AppResult<PathBuf> {
    let p = PathBuf::from(raw);
    if !p.is_absolute() {
        return Err(AppError::Invalid("Export path must be absolute".into()));
    }
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !allowed.contains(&ext.as_str()) {
        return Err(AppError::Invalid(format!("Exports must be one of: {}", allowed.join(", "))));
    }
    Ok(p)
}
