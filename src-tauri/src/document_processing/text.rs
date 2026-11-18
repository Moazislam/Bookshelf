use super::{Chunk, Extracted, Format};
use crate::error::AppResult;
use std::path::Path;

/// Read a text file as UTF-8, honouring UTF-8/UTF-16 BOMs and replacing invalid bytes.
pub fn read_text(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    Ok(decode(&bytes))
}

pub fn decode(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if bytes.len() >= 2 && (bytes[..2] == [0xFF, 0xFE] || bytes[..2] == [0xFE, 0xFF]) {
        let le = bytes[0] == 0xFF;
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

const CHUNK_TARGET: usize = 3000;

pub fn extract(path: &Path, format: Format) -> AppResult<Extracted> {
    let content = read_text(path)?;
    let title = if format == Format::Md {
        content
            .lines()
            .find(|l| l.trim_start().starts_with("# "))
            .map(|l| l.trim_start().trim_start_matches("# ").trim().to_string())
    } else {
        None
    };
    Ok(Extracted {
        title,
        chunks: chunk_text(&content),
        ..Default::default()
    })
}

/// Splits text into search chunks. Locators are UTF-16 offsets so that the
/// frontend (JavaScript strings) can map a search hit straight to a position.
pub fn chunk_text(content: &str) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut buf = String::new();
    let mut buf_start_u16 = 0usize;
    let mut offset_u16 = 0usize;
    for line in content.split_inclusive('\n') {
        if buf.is_empty() {
            buf_start_u16 = offset_u16;
        }
        buf.push_str(line);
        offset_u16 += line.encode_utf16().count();
        if buf.len() >= CHUNK_TARGET {
            push_chunk(&mut chunks, &mut buf, buf_start_u16);
        }
    }
    push_chunk(&mut chunks, &mut buf, buf_start_u16);
    chunks
}

fn push_chunk(chunks: &mut Vec<Chunk>, buf: &mut String, start: usize) {
    if !buf.trim().is_empty() {
        chunks.push(Chunk { locator: format!("{start}"), label: None, text: buf.clone() });
    }
    buf.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunk_offsets_are_utf16() {
        let s = "é😀\n".repeat(2000);
        let chunks = chunk_text(&s);
        assert!(chunks.len() > 1);
        let second: usize = chunks[1].locator.parse().unwrap();
        let prefix: String = s.encode_utf16().take(second).map(|_| ' ').collect();
        assert_eq!(prefix.len(), second);
        assert_eq!(second % 4, 0); // each line is 4 utf16 units
    }
    #[test]
    fn decodes_utf16_bom() {
        assert_eq!(decode(&[0xFF, 0xFE, b'h', 0, b'i', 0]), "hi");
    }
}
