use crate::commands::documents::{DOC_SELECT, row_to_document};
use crate::error::AppResult;
use crate::models::Document;
use crate::state::AppState;
use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::State;

/// Snippet markers. The frontend splits on these instead of rendering HTML,
/// so document text can never inject markup.
const MARK_START: &str = "\u{1}";
const MARK_END: &str = "\u{2}";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentHit {
    pub document_id: String,
    pub document_title: String,
    pub format: String,
    pub locator: String,
    pub label: Option<String>,
    pub snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightHit {
    pub id: String,
    pub document_id: String,
    pub document_title: String,
    pub locator: String,
    pub label: Option<String>,
    pub color: String,
    pub snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHit {
    pub id: String,
    pub title: String,
    pub document_title: Option<String>,
    pub snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub documents: Vec<Document>,
    pub content: Vec<ContentHit>,
    pub highlights: Vec<HighlightHit>,
    pub notes: Vec<NoteHit>,
}

/// Turn free text into a safe FTS5 query: every token is quoted and prefix-matched.
pub fn fts_query(input: &str) -> Option<String> {
    let tokens: Vec<String> = input
        .split(|c: char| c.is_whitespace() || "\"'()*:^{}[],;!?".contains(c))
        .map(|t| t.trim_matches(|c: char| c == '-' || c == '+' || c == '.'))
        .filter(|t| !t.is_empty())
        .take(12)
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    (!tokens.is_empty()).then(|| tokens.join(" "))
}

pub fn search_inner(conn: &Connection, query: &str, limit: i64) -> AppResult<SearchResults> {
    let empty = SearchResults { documents: vec![], content: vec![], highlights: vec![], notes: vec![] };
    let Some(q) = fts_query(query) else { return Ok(empty) };
    let like = format!("%{}%", query.trim().replace('%', "").replace('_', ""));

    // Documents: metadata FTS + tag / collection name matches.
    let documents = conn
        .prepare(&format!(
            "{DOC_SELECT} WHERE d.id IN (
                SELECT id FROM documents_fts WHERE documents_fts MATCH ?1
                UNION SELECT dt.document_id FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE t.name LIKE ?2
                UNION SELECT dc.document_id FROM document_collections dc JOIN collections c ON c.id = dc.collection_id WHERE c.name LIKE ?2
            ) ORDER BY d.opened_at DESC NULLS LAST LIMIT ?3"
        ))?
        .query_map(params![q, like, limit], row_to_document)?
        .collect::<Result<Vec<_>, _>>()?;

    let content = conn
        .prepare(&format!(
            "SELECT t.document_id, d.title, d.format, t.locator, t.label,
                snippet(doc_text, 3, '{MARK_START}', '{MARK_END}', '…', 18)
             FROM doc_text t JOIN documents d ON d.id = t.document_id
             WHERE doc_text MATCH ?1 ORDER BY rank LIMIT ?2"
        ))?
        .query_map(params![q, limit * 2], |r| {
            Ok(ContentHit {
                document_id: r.get(0)?,
                document_title: r.get(1)?,
                format: r.get(2)?,
                locator: r.get(3)?,
                label: r.get(4)?,
                snippet: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let highlights = conn
        .prepare(&format!(
            "SELECT h.id, h.document_id, d.title, h.locator, h.label, h.color,
                snippet(highlights_fts, -1, '{MARK_START}', '{MARK_END}', '…', 24)
             FROM highlights_fts f JOIN highlights h ON h.id = f.id JOIN documents d ON d.id = h.document_id
             WHERE highlights_fts MATCH ?1 ORDER BY rank LIMIT ?2"
        ))?
        .query_map(params![q, limit], |r| {
            Ok(HighlightHit {
                id: r.get(0)?,
                document_id: r.get(1)?,
                document_title: r.get(2)?,
                locator: r.get(3)?,
                label: r.get(4)?,
                color: r.get(5)?,
                snippet: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let notes = conn
        .prepare(&format!(
            "SELECT n.id, n.title, d.title, snippet(notes_fts, -1, '{MARK_START}', '{MARK_END}', '…', 20)
             FROM notes_fts f JOIN notes n ON n.id = f.id LEFT JOIN documents d ON d.id = n.document_id
             WHERE notes_fts MATCH ?1 ORDER BY rank LIMIT ?2"
        ))?
        .query_map(params![q, limit], |r| {
            Ok(NoteHit { id: r.get(0)?, title: r.get(1)?, document_title: r.get(2)?, snippet: r.get(3)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(SearchResults { documents, content, highlights, notes })
}

#[tauri::command]
pub fn search(state: State<AppState>, query: String, limit: Option<i64>) -> AppResult<SearchResults> {
    search_inner(&state.db.conn(), &query, limit.unwrap_or(20).clamp(1, 200))
}

/// Search inside one document (used by the reader's find bar for EPUB/text).
#[tauri::command]
pub fn search_in_document(state: State<AppState>, document_id: String, query: String) -> AppResult<Vec<ContentHit>> {
    let Some(q) = fts_query(&query) else { return Ok(vec![]) };
    let conn = state.db.conn();
    let v = conn
        .prepare(&format!(
            "SELECT t.document_id, d.title, d.format, t.locator, t.label,
                snippet(doc_text, 3, '{MARK_START}', '{MARK_END}', '…', 14)
             FROM doc_text t JOIN documents d ON d.id = t.document_id
             WHERE doc_text MATCH ?1 AND t.document_id = ?2 ORDER BY rank LIMIT 200"
        ))?
        .query_map(params![q, document_id], |r| {
            Ok(ContentHit {
                document_id: r.get(0)?,
                document_title: r.get(1)?,
                format: r.get(2)?,
                locator: r.get(3)?,
                label: r.get(4)?,
                snippet: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::fts_query;
    #[test]
    fn sanitises_queries() {
        assert_eq!(fts_query("hello world").as_deref(), Some("\"hello\"* \"world\"*"));
        assert_eq!(fts_query("\"x\" OR (y)").as_deref(), Some("\"x\"* \"OR\"* \"y\"*"));
        assert_eq!(fts_query("  ** "), None);
    }
}
