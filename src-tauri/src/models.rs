use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub path: String,
    pub format: String,
    pub file_name: String,
    pub title: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub language: Option<String>,
    pub file_size: i64,
    pub page_count: Option<i64>,
    pub has_cover: bool,
    pub status: String,
    pub favorite: bool,
    pub progress: f64,
    pub added_at: i64,
    pub opened_at: Option<i64>,
    pub updated_at: i64,
    pub missing: bool,
    pub metadata_ready: bool,
    pub text_indexed: bool,
    pub tag_ids: Vec<String>,
    pub collection_ids: Vec<String>,
    pub highlight_count: i64,
    pub note_count: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPatch {
    pub title: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub language: Option<String>,
    pub status: Option<String>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub document_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInput {
    pub parent_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPatch {
    /// `Some(None)` moves the collection to the top level.
    #[serde(default, with = "double_option")]
    pub parent_id: Option<Option<String>>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
    pub document_count: i64,
    pub note_count: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    pub document_id: String,
    pub document_title: String,
    pub document_format: String,
    pub locator: String,
    pub label: Option<String>,
    pub anchor: serde_json::Value,
    pub text: String,
    pub color: String,
    pub comment: Option<String>,
    pub sort_key: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightInput {
    pub document_id: String,
    pub locator: String,
    pub label: Option<String>,
    pub anchor: serde_json::Value,
    pub text: String,
    pub color: String,
    pub comment: Option<String>,
    pub sort_key: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub document_id: String,
    pub locator: String,
    pub label: String,
    pub description: Option<String>,
    pub sort_key: f64,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkInput {
    pub document_id: String,
    pub locator: String,
    pub label: String,
    pub description: Option<String>,
    pub sort_key: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub document_id: Option<String>,
    pub document_title: Option<String>,
    pub highlight_id: Option<String>,
    pub highlight_text: Option<String>,
    pub title: String,
    pub body: String,
    pub pinned: bool,
    pub tag_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub document_id: Option<String>,
    pub highlight_id: Option<String>,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub pinned: Option<bool>,
    #[serde(default, with = "double_option")]
    pub document_id: Option<Option<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPosition {
    pub document_id: String,
    pub locator: String,
    pub progress: f64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChunk {
    pub locator: String,
    pub label: Option<String>,
    pub text: String,
}

/// Distinguishes "field absent" (None) from "field explicitly null" (Some(None)).
mod double_option {
    use serde::{Deserialize, Deserializer};
    pub fn deserialize<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(d).map(Some)
    }
}
