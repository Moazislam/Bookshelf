use super::{Extracted, clean_meta, cover::is_image_name};
use crate::error::{AppError, AppResult};
use std::cmp::Ordering;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

pub fn open(path: &Path) -> AppResult<ZipArchive<std::io::BufReader<File>>> {
    Ok(ZipArchive::new(std::io::BufReader::new(File::open(path)?))?)
}

/// Image entry names in reading order (natural sort, so "page2" < "page10").
pub fn page_names<R: Read + std::io::Seek>(zip: &ZipArchive<R>) -> Vec<String> {
    let mut names: Vec<String> = zip
        .file_names()
        .filter(|n| is_image_name(n) && !n.starts_with("__MACOSX") && !n.rsplit('/').next().unwrap_or("").starts_with('.'))
        .map(String::from)
        .collect();
    names.sort_by(|a, b| natural_cmp(a, b));
    names
}

pub fn read_page(path: &Path, index: usize) -> AppResult<(String, Vec<u8>)> {
    let mut zip = open(path)?;
    let names = page_names(&zip);
    let name = names
        .get(index)
        .ok_or_else(|| AppError::NotFound(format!("Page {index} does not exist")))?
        .clone();
    let mut entry = zip.by_name(&name)?;
    if entry.size() > 128 * 1024 * 1024 {
        return Err(AppError::Invalid("Comic page is too large".into()));
    }
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf)?;
    Ok((name, buf))
}

pub fn extract(path: &Path) -> AppResult<Extracted> {
    let mut zip = open(path)?;
    let names = page_names(&zip);
    if names.is_empty() {
        return Err(AppError::Invalid("Comic archive contains no images".into()));
    }
    let mut ex = Extracted { page_count: Some(names.len() as i64), ..Default::default() };

    if let Ok(mut info) = zip.by_name("ComicInfo.xml") {
        let mut s = String::new();
        if info.read_to_string(&mut s).is_ok() {
            let series = tag(&s, "Series");
            let number = tag(&s, "Number");
            ex.title = tag(&s, "Title").or_else(|| series.map(|se| match number {
                Some(n) => format!("{se} #{n}"),
                None => se,
            }));
            ex.author = clean_meta(tag(&s, "Writer"));
            ex.description = clean_meta(tag(&s, "Summary"));
            ex.publisher = clean_meta(tag(&s, "Publisher"));
            ex.published = tag(&s, "Year");
            ex.language = tag(&s, "LanguageISO");
        }
    }

    let mut first = zip.by_name(&names[0])?;
    let mut buf = Vec::new();
    first.read_to_end(&mut buf)?;
    ex.cover = Some(buf);
    Ok(ex)
}

fn tag(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let s = xml.find(&open)? + open.len();
    let e = xml[s..].find(&close)? + s;
    let v = xml[s..e].trim();
    (!v.is_empty()).then(|| super::html::to_text(v))
}

pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let na: String = std::iter::from_fn(|| ai.next_if(|c| c.is_ascii_digit())).collect();
                let nb: String = std::iter::from_fn(|| bi.next_if(|c| c.is_ascii_digit())).collect();
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.to_ascii_lowercase().cmp(&y.to_ascii_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                ai.next();
                bi.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn natural_sorting() {
        let mut v = vec!["p10.jpg", "p2.jpg", "p1.jpg", "P3.jpg"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["p1.jpg", "p2.jpg", "P3.jpg", "p10.jpg"]);
    }
}
