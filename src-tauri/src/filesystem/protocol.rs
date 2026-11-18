//! `bookfile://` protocol. The frontend never receives raw filesystem access:
//! it asks for a document by id and we resolve the path from the database.
//!
//!   bookfile://localhost/doc/<id>          whole document (supports Range)
//!   bookfile://localhost/cbz/<id>/<index>  a single comic page image
//!   bookfile://localhost/cover/<id>        cached cover thumbnail
//!
//! (On Windows the webview sees these as http://bookfile.localhost/...)

use crate::document_processing::{Format, cbz, cover::image_mime};
use crate::state::AppState;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use tauri::http::{Request, Response, StatusCode, header};

type Resp = Response<Vec<u8>>;

pub fn handle(state: &AppState, request: &Request<Vec<u8>>) -> Resp {
    if request.method() == tauri::http::Method::OPTIONS {
        return base(StatusCode::NO_CONTENT).body(Vec::new()).unwrap();
    }
    let path = request.uri().path().trim_start_matches('/').to_string();
    let parts: Vec<&str> = path.split('/').collect();
    let result = match parts.as_slice() {
        ["doc", id] => serve_document(state, id, request),
        ["cbz", id, index] => serve_cbz_page(state, id, index),
        ["cover", id] => serve_cover(state, id),
        _ => Err((StatusCode::NOT_FOUND, "Unknown resource".to_string())),
    };
    result.unwrap_or_else(|(code, msg)| {
        base(code).header(header::CONTENT_TYPE, "text/plain").body(msg.into_bytes()).unwrap()
    })
}

fn base(code: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Content-Length, Accept-Ranges")
}

fn lookup(state: &AppState, id: &str) -> Result<(PathBuf, Format), (StatusCode, String)> {
    let conn = state.db.conn();
    let row: Result<(String, String), _> =
        conn.query_row("SELECT path, format FROM documents WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)));
    drop(conn);
    let (path, format) = row.map_err(|_| (StatusCode::NOT_FOUND, "Document not found".to_string()))?;
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err((StatusCode::GONE, "The file has been moved or deleted".to_string()));
    }
    let format = Format::from_path(&path)
        .or(match format.as_str() {
            "pdf" => Some(Format::Pdf),
            "epub" => Some(Format::Epub),
            "cbz" => Some(Format::Cbz),
            "md" => Some(Format::Md),
            _ => Some(Format::Txt),
        })
        .unwrap();
    Ok((path, format))
}

fn serve_document(state: &AppState, id: &str, req: &Request<Vec<u8>>) -> Result<Resp, (StatusCode, String)> {
    let (path, format) = lookup(state, id)?;
    let err = |e: std::io::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    let mut file = File::open(&path).map_err(err)?;
    let len = file.metadata().map_err(err)?.len();

    let range = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_range(v, len));

    let builder = base(StatusCode::OK)
        .header(header::CONTENT_TYPE, format.mime())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store");

    if let Some((start, end)) = range {
        let size = (end - start + 1) as usize;
        let mut buf = vec![0u8; size];
        file.seek(SeekFrom::Start(start)).map_err(err)?;
        file.read_exact(&mut buf).map_err(err)?;
        return Ok(builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::CONTENT_LENGTH, size)
            .body(buf)
            .unwrap());
    }

    let mut buf = Vec::with_capacity(len as usize);
    file.read_to_end(&mut buf).map_err(err)?;
    Ok(builder.header(header::CONTENT_LENGTH, buf.len()).body(buf).unwrap())
}

fn parse_range(v: &str, len: u64) -> Option<(u64, u64)> {
    let spec = v.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (s, e) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (start, end) = if s.is_empty() {
        let suffix: u64 = e.parse().ok()?;
        (len.saturating_sub(suffix), len - 1)
    } else {
        let start: u64 = s.parse().ok()?;
        let end: u64 = if e.is_empty() { len - 1 } else { e.parse::<u64>().ok()?.min(len - 1) };
        (start, end)
    };
    (start <= end && start < len).then_some((start, end))
}

fn serve_cbz_page(state: &AppState, id: &str, index: &str) -> Result<Resp, (StatusCode, String)> {
    let (path, _) = lookup(state, id)?;
    let index: usize = index.parse().map_err(|_| (StatusCode::BAD_REQUEST, "Bad page index".to_string()))?;
    let (name, bytes) = cbz::read_page(&path, index).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    Ok(base(StatusCode::OK)
        .header(header::CONTENT_TYPE, image_mime(&name))
        .header(header::CACHE_CONTROL, "max-age=3600")
        .body(bytes)
        .unwrap())
}

fn serve_cover(state: &AppState, id: &str) -> Result<Resp, (StatusCode, String)> {
    // Only ever read from our own covers directory; the id is validated by the DB lookup.
    let conn = state.db.conn();
    let cover: Option<String> = conn
        .query_row("SELECT cover_path FROM documents WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| (StatusCode::NOT_FOUND, "Document not found".to_string()))?;
    drop(conn);
    let file = cover.ok_or((StatusCode::NOT_FOUND, "No cover".to_string()))?;
    let path = state.covers_dir.join(file);
    let bytes = std::fs::read(&path).map_err(|_| (StatusCode::NOT_FOUND, "Cover missing".to_string()))?;
    Ok(base(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(bytes)
        .unwrap())
}

#[cfg(test)]
mod tests {
    use super::parse_range;
    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=0-5000", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=2000-", 1000), None);
    }
}
