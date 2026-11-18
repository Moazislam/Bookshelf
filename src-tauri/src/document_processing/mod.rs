pub mod cbz;
pub mod cover;
pub mod epub;
pub mod hash;
pub mod html;
pub mod text;

use crate::error::AppResult;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Pdf,
    Epub,
    Txt,
    Md,
    Cbz,
}

impl Format {
    pub fn from_path(path: &Path) -> Option<Format> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "pdf" => Some(Format::Pdf),
            "epub" => Some(Format::Epub),
            "txt" | "text" => Some(Format::Txt),
            "md" | "markdown" => Some(Format::Md),
            "cbz" => Some(Format::Cbz),
            _ => None,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Format::Pdf => "pdf",
            Format::Epub => "epub",
            Format::Txt => "txt",
            Format::Md => "md",
            Format::Cbz => "cbz",
        }
    }
    pub fn mime(&self) -> &'static str {
        match self {
            Format::Pdf => "application/pdf",
            Format::Epub => "application/epub+zip",
            Format::Txt => "text/plain; charset=utf-8",
            Format::Md => "text/markdown; charset=utf-8",
            Format::Cbz => "application/vnd.comicbook+zip",
        }
    }
}

/// A unit of searchable text: a page, chapter or text block.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub locator: String,
    pub label: Option<String>,
    pub text: String,
}

#[derive(Debug, Default)]
pub struct Extracted {
    pub title: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub language: Option<String>,
    pub page_count: Option<i64>,
    pub cover: Option<Vec<u8>>,
    pub chunks: Vec<Chunk>,
}

pub fn extract(path: &Path, format: Format) -> AppResult<Extracted> {
    match format {
        Format::Epub => epub::extract(path),
        Format::Cbz => cbz::extract(path),
        Format::Txt | Format::Md => text::extract(path, format),
        // PDF metadata, cover and text are extracted by pdf.js in the frontend.
        Format::Pdf => Ok(Extracted::default()),
    }
}

pub fn clean_meta(s: Option<String>) -> Option<String> {
    s.map(|v| v.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|v| !v.is_empty())
}
