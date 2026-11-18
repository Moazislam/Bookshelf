use crate::error::AppResult;
use std::fs::File;
use std::io::{BufReader, copy};
use std::path::Path;

/// Content hash used for duplicate detection (independent of file name/location).
pub fn file_hash(path: &Path) -> AppResult<String> {
    let mut reader = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut hasher = blake3::Hasher::new();
    copy(&mut reader, &mut hasher)?;
    Ok(hasher.finalize().to_hex().to_string())
}
