-- BookShelf schema v1
-- All timestamps are unix epoch milliseconds.

CREATE TABLE documents (
  id              TEXT PRIMARY KEY,
  path            TEXT NOT NULL,
  hash            TEXT NOT NULL UNIQUE,
  format          TEXT NOT NULL CHECK (format IN ('pdf','epub','txt','md','cbz')),
  file_name       TEXT NOT NULL,
  title           TEXT NOT NULL,
  author          TEXT,
  description     TEXT,
  publisher       TEXT,
  published       TEXT,
  language        TEXT,
  file_size       INTEGER NOT NULL DEFAULT 0,
  page_count      INTEGER,
  cover_path      TEXT,
  status          TEXT NOT NULL DEFAULT 'unread'
                  CHECK (status IN ('unread','reading','completed','on_hold','abandoned')),
  favorite        INTEGER NOT NULL DEFAULT 0,
  progress        REAL NOT NULL DEFAULT 0,
  added_at        INTEGER NOT NULL,
  opened_at       INTEGER,
  updated_at      INTEGER NOT NULL,
  missing         INTEGER NOT NULL DEFAULT 0,
  metadata_ready  INTEGER NOT NULL DEFAULT 0,
  text_indexed    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_documents_added    ON documents(added_at DESC);
CREATE INDEX idx_documents_opened   ON documents(opened_at DESC);
CREATE INDEX idx_documents_title    ON documents(title COLLATE NOCASE);
CREATE INDEX idx_documents_author   ON documents(author COLLATE NOCASE);
CREATE INDEX idx_documents_status   ON documents(status);
CREATE INDEX idx_documents_path     ON documents(path);

CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES collections(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT NOT NULL DEFAULT 'folder',
  color       TEXT NOT NULL DEFAULT 'slate',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_collections_parent ON collections(parent_id);

-- Link rows cascade; documents themselves are never deleted by a collection delete.
CREATE TABLE document_collections (
  document_id   TEXT NOT NULL REFERENCES documents(id)   ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (document_id, collection_id)
);
CREATE INDEX idx_doccol_collection ON document_collections(collection_id);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'slate'
);

CREATE TABLE document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags(id)      ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);
CREATE INDEX idx_doctags_tag ON document_tags(tag_id);

CREATE TABLE highlights (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  locator     TEXT NOT NULL,           -- page number / epub cfi / char offset
  label       TEXT,                    -- human readable location ("Page 12", chapter title)
  anchor      TEXT NOT NULL,           -- JSON, format specific anchor data
  text        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'yellow',
  comment     TEXT,
  sort_key    REAL NOT NULL DEFAULT 0, -- reading order within document
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_highlights_doc ON highlights(document_id, sort_key);
CREATE INDEX idx_highlights_created ON highlights(created_at DESC);

CREATE TABLE notes (
  id           TEXT PRIMARY KEY,
  document_id  TEXT REFERENCES documents(id)  ON DELETE SET NULL,
  highlight_id TEXT REFERENCES highlights(id) ON DELETE SET NULL,
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_notes_doc ON notes(document_id);
CREATE INDEX idx_notes_highlight ON notes(highlight_id);
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX idx_notetags_tag ON note_tags(tag_id);

CREATE TABLE bookmarks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  locator     TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  sort_key    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_bookmarks_doc ON bookmarks(document_id, sort_key);

CREATE TABLE reading_positions (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  locator     TEXT NOT NULL,
  progress    REAL NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE reading_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  pages_read     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_doc ON reading_sessions(document_id);
CREATE INDEX idx_sessions_started ON reading_sessions(started_at);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Per-document cached data (epub locations, toc, etc.)
CREATE TABLE document_cache (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  PRIMARY KEY (document_id, key)
);

-- Full text search -----------------------------------------------------------

CREATE VIRTUAL TABLE doc_text USING fts5(
  document_id UNINDEXED,
  locator     UNINDEXED,
  label       UNINDEXED,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE documents_fts USING fts5(
  id UNINDEXED, title, author, description,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(id, title, author, description)
  VALUES (new.id, new.title, coalesce(new.author,''), coalesce(new.description,''));
END;
CREATE TRIGGER documents_au AFTER UPDATE OF title, author, description ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
  INSERT INTO documents_fts(id, title, author, description)
  VALUES (new.id, new.title, coalesce(new.author,''), coalesce(new.description,''));
END;
CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
  DELETE FROM doc_text WHERE document_id = old.id;
END;

CREATE VIRTUAL TABLE highlights_fts USING fts5(
  id UNINDEXED, text, comment,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER highlights_ai AFTER INSERT ON highlights BEGIN
  INSERT INTO highlights_fts(id, text, comment) VALUES (new.id, new.text, coalesce(new.comment,''));
END;
CREATE TRIGGER highlights_au AFTER UPDATE OF text, comment ON highlights BEGIN
  DELETE FROM highlights_fts WHERE id = old.id;
  INSERT INTO highlights_fts(id, text, comment) VALUES (new.id, new.text, coalesce(new.comment,''));
END;
CREATE TRIGGER highlights_ad AFTER DELETE ON highlights BEGIN
  DELETE FROM highlights_fts WHERE id = old.id;
END;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(id, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF title, body ON notes BEGIN
  DELETE FROM notes_fts WHERE id = old.id;
  INSERT INTO notes_fts(id, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE id = old.id;
END;
