//! Tolerant HTML/XHTML → plain text conversion used for search indexing.
//! Hand-rolled on purpose: ebook markup is frequently malformed and a strict
//! XML parser would reject whole chapters.

const BLOCK_TAGS: &[&str] = &[
    "p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "blockquote", "section",
    "article", "pre", "hr", "dt", "dd", "figcaption", "td", "th",
];
const SKIP_TAGS: &[&str] = &["script", "style", "head", "svg", "noscript"];

pub fn to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut chars = html.char_indices().peekable();
    let mut skip_depth: Option<String> = None;

    while let Some((i, c)) = chars.next() {
        if c == '<' {
            // Comments / CDATA
            if html[i..].starts_with("<!--") {
                if let Some(end) = html[i..].find("-->") {
                    advance_to(&mut chars, i + end + 3);
                    continue;
                }
                break;
            }
            let end = match html[i..].find('>') {
                Some(e) => i + e,
                None => break,
            };
            let tag = &html[i + 1..end];
            let closing = tag.starts_with('/');
            let name: String = tag
                .trim_start_matches('/')
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == ':')
                .collect::<String>()
                .to_ascii_lowercase();
            let local = name.rsplit(':').next().unwrap_or(&name).to_string();

            if let Some(skip) = &skip_depth {
                if closing && &local == skip {
                    skip_depth = None;
                }
            } else if !closing && SKIP_TAGS.contains(&local.as_str()) && !tag.ends_with('/') {
                skip_depth = Some(local.clone());
            } else if BLOCK_TAGS.contains(&local.as_str()) && !out.ends_with('\n') {
                out.push('\n');
            }
            advance_to(&mut chars, end + 1);
            continue;
        }
        if skip_depth.is_some() {
            continue;
        }
        if c == '&' {
            if let Some(semi) = html[i..].find(';').filter(|s| *s <= 10) {
                let entity = &html[i + 1..i + semi];
                if let Some(decoded) = decode_entity(entity) {
                    out.push(decoded);
                    advance_to(&mut chars, i + semi + 1);
                    continue;
                }
            }
        }
        out.push(c);
    }
    normalize_ws(&out)
}

fn advance_to(chars: &mut std::iter::Peekable<std::str::CharIndices>, pos: usize) {
    while let Some(&(j, _)) = chars.peek() {
        if j >= pos {
            break;
        }
        chars.next();
    }
}

fn decode_entity(e: &str) -> Option<char> {
    match e {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some(' '),
        "mdash" => Some('—'),
        "ndash" => Some('–'),
        "hellip" => Some('…'),
        "rsquo" => Some('’'),
        "lsquo" => Some('‘'),
        "rdquo" => Some('”'),
        "ldquo" => Some('“'),
        _ if e.starts_with("#x") || e.starts_with("#X") => {
            u32::from_str_radix(&e[2..], 16).ok().and_then(char::from_u32)
        }
        _ if e.starts_with('#') => e[1..].parse::<u32>().ok().and_then(char::from_u32),
        _ => None,
    }
}

fn normalize_ws(s: &str) -> String {
    s.lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// First heading text in an HTML document, used as a chapter label.
pub fn first_heading(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    for tag in ["<h1", "<h2", "<h3", "<title"] {
        if let Some(start) = lower.find(tag) {
            let open_end = lower[start..].find('>')? + start + 1;
            let close_tag = format!("</{}", &tag[1..]);
            let close = lower[open_end..].find(&close_tag)? + open_end;
            let text = to_text(&html[open_end..close]).replace('\n', " ");
            if !text.trim().is_empty() && text.len() < 200 {
                return Some(text.trim().to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_tags_and_scripts() {
        let html = "<html><head><title>x</title></head><body><p>Hello &amp; <b>world</b></p><script>var a=1;</script><p>Line&#160;two</p></body></html>";
        assert_eq!(to_text(html), "Hello & world\nLine two");
    }
    #[test]
    fn heading() {
        assert_eq!(first_heading("<body><h2 class='c'>Chapter <i>One</i></h2></body>").as_deref(), Some("Chapter One"));
    }
}
