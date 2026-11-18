use super::{Chunk, Extracted, clean_meta, cover::is_image_name, html};
use crate::error::{AppError, AppResult};
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

type Zip = ZipArchive<std::io::BufReader<File>>;

struct ManifestItem {
    href: String,
    media_type: String,
    properties: String,
}

#[derive(Default)]
struct Opf {
    title: Option<String>,
    creators: Vec<String>,
    description: Option<String>,
    publisher: Option<String>,
    date: Option<String>,
    language: Option<String>,
    cover_id: Option<String>,
    manifest: HashMap<String, ManifestItem>,
    spine: Vec<String>,
}

pub fn extract(path: &Path) -> AppResult<Extracted> {
    let mut zip = ZipArchive::new(std::io::BufReader::new(File::open(path)?))?;
    let container = read_entry_string(&mut zip, "META-INF/container.xml")
        .map_err(|_| AppError::Invalid("Not a valid EPUB: missing container.xml".into()))?;
    let opf_path = rootfile_path(&container)
        .ok_or_else(|| AppError::Invalid("Not a valid EPUB: no rootfile".into()))?;
    let opf_dir = match opf_path.rfind('/') {
        Some(i) => opf_path[..=i].to_string(),
        None => String::new(),
    };
    let opf = parse_opf(&read_entry_string(&mut zip, &opf_path)?);

    let cover = find_cover(&opf).and_then(|href| read_entry_bytes(&mut zip, &resolve(&opf_dir, &href)).ok());

    let mut chunks = Vec::new();
    for (i, idref) in opf.spine.iter().enumerate() {
        let Some(item) = opf.manifest.get(idref) else { continue };
        if !item.media_type.contains("html") {
            continue;
        }
        let full = resolve(&opf_dir, &item.href);
        let Ok(markup) = read_entry_string(&mut zip, &full) else { continue };
        let text = html::to_text(&markup);
        if text.trim().is_empty() {
            continue;
        }
        let label = html::first_heading(&markup).or_else(|| Some(format!("Section {}", i + 1)));
        // Locator is the spine href (relative to the OPF) which epub.js can display directly.
        chunks.push(Chunk { locator: item.href.clone(), label, text });
    }

    Ok(Extracted {
        title: clean_meta(opf.title),
        author: clean_meta(Some(opf.creators.join(", "))),
        description: clean_meta(opf.description.map(|d| html::to_text(&d))),
        publisher: clean_meta(opf.publisher),
        published: clean_meta(opf.date),
        language: clean_meta(opf.language),
        page_count: Some(opf.spine.len() as i64),
        cover,
        chunks,
    })
}

fn read_entry_string(zip: &mut Zip, name: &str) -> AppResult<String> {
    let bytes = read_entry_bytes(zip, name)?;
    Ok(super::text::decode(&bytes))
}

fn read_entry_bytes(zip: &mut Zip, name: &str) -> AppResult<Vec<u8>> {
    let decoded = percent_encoding::percent_decode_str(name).decode_utf8_lossy().into_owned();
    let entry_name = if zip.index_for_name(&decoded).is_some() { decoded } else { name.to_string() };
    let mut file = zip.by_name(&entry_name)?;
    // Guard against zip bombs: chapters and covers are never this large.
    if file.size() > 64 * 1024 * 1024 {
        return Err(AppError::Invalid(format!("Entry {name} is too large")));
    }
    let mut buf = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

fn resolve(base_dir: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let mut parts: Vec<&str> = base_dir.split('/').filter(|s| !s.is_empty()).collect();
    for seg in href.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn attr(e: &BytesStart, key: &str) -> Option<String> {
    e.attributes().flatten().find_map(|a| {
        (a.key.local_name().as_ref() == key.as_bytes())
            .then(|| a.unescape_value().ok().map(|v| v.into_owned()))
            .flatten()
    })
}

fn rootfile_path(container: &str) -> Option<String> {
    let mut reader = Reader::from_str(container);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"rootfile" => {
                return attr(&e, "full-path");
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
    }
}

fn parse_opf(xml: &str) -> Opf {
    let mut opf = Opf::default();
    let mut reader = Reader::from_str(xml);
    let mut current: Option<String> = None;
    let mut text = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                handle_element(&mut opf, &name, &e);
                if matches!(name.as_str(), "title" | "creator" | "description" | "publisher" | "date" | "language") {
                    current = Some(name);
                    text.clear();
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                handle_element(&mut opf, &name, &e);
            }
            Ok(Event::Text(t)) => {
                if current.is_some() {
                    if let Ok(s) = t.unescape() {
                        text.push_str(&s);
                    }
                }
            }
            Ok(Event::CData(t)) => {
                if current.is_some() {
                    text.push_str(&String::from_utf8_lossy(&t));
                }
            }
            Ok(Event::End(_)) => {
                if let Some(name) = current.take() {
                    let v = text.trim().to_string();
                    if !v.is_empty() {
                        match name.as_str() {
                            "title" if opf.title.is_none() => opf.title = Some(v),
                            "creator" => opf.creators.push(v),
                            "description" if opf.description.is_none() => opf.description = Some(v),
                            "publisher" if opf.publisher.is_none() => opf.publisher = Some(v),
                            "date" if opf.date.is_none() => opf.date = Some(v),
                            "language" if opf.language.is_none() => opf.language = Some(v),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    opf
}

fn handle_element(opf: &mut Opf, name: &str, e: &BytesStart) {
    match name {
        "item" => {
            if let (Some(id), Some(href)) = (attr(e, "id"), attr(e, "href")) {
                opf.manifest.insert(
                    id,
                    ManifestItem {
                        href,
                        media_type: attr(e, "media-type").unwrap_or_default(),
                        properties: attr(e, "properties").unwrap_or_default(),
                    },
                );
            }
        }
        "itemref" => {
            if let Some(idref) = attr(e, "idref") {
                opf.spine.push(idref);
            }
        }
        "meta" => {
            if attr(e, "name").as_deref() == Some("cover") {
                opf.cover_id = attr(e, "content");
            }
        }
        _ => {}
    }
}

fn find_cover(opf: &Opf) -> Option<String> {
    if let Some(item) = opf.manifest.values().find(|i| i.properties.split_whitespace().any(|p| p == "cover-image")) {
        return Some(item.href.clone());
    }
    if let Some(item) = opf.cover_id.as_ref().and_then(|id| opf.manifest.get(id)) {
        if item.media_type.starts_with("image/") || is_image_name(&item.href) {
            return Some(item.href.clone());
        }
    }
    opf.manifest
        .iter()
        .find(|(id, i)| id.to_ascii_lowercase().contains("cover") && i.media_type.starts_with("image/"))
        .or_else(|| opf.manifest.iter().find(|(_, i)| i.href.to_ascii_lowercase().contains("cover") && i.media_type.starts_with("image/")))
        .map(|(_, i)| i.href.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_relative_paths() {
        assert_eq!(resolve("OEBPS/", "Text/ch1.xhtml#a"), "OEBPS/Text/ch1.xhtml");
        assert_eq!(resolve("OEBPS/Text/", "../Images/c.jpg"), "OEBPS/Images/c.jpg");
        assert_eq!(resolve("", "c.jpg"), "c.jpg");
    }
    #[test]
    fn parses_opf() {
        let xml = r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>My Book</dc:title><dc:creator>Ann</dc:creator><dc:creator>Bob</dc:creator><meta name="cover" content="img"/></metadata>
            <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="img" href="cover.jpg" media-type="image/jpeg"/></manifest>
            <spine><itemref idref="c1"/></spine></package>"#;
        let opf = parse_opf(xml);
        assert_eq!(opf.title.as_deref(), Some("My Book"));
        assert_eq!(opf.creators, vec!["Ann", "Bob"]);
        assert_eq!(opf.spine, vec!["c1"]);
        assert_eq!(find_cover(&opf).as_deref(), Some("cover.jpg"));
    }
}
