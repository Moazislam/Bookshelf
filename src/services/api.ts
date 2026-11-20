/**
 * Typed wrappers for every Rust command. Components never call `invoke` directly.
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  Bookmark,
  Collection,
  ContentHit,
  Document,
  DocumentPatch,
  Highlight,
  HighlightColor,
  HistoryEntry,
  LibraryInfo,
  Note,
  ReadingPosition,
  SearchResults,
  Stats,
  Tag,
  TextChunk,
  Anchor,
} from "@/types";

const call = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Phone or tablet build: no windows to manage, no drag & drop from a file manager. */
export const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// URLs served by the bookfile:// protocol --------------------------------------
export const fileUrl = {
  document: (id: string) => convertFileSrc(`doc/${id}`, "bookfile").replace(/%2F/gi, "/"),
  cbzPage: (id: string, index: number) => convertFileSrc(`cbz/${id}/${index}`, "bookfile").replace(/%2F/gi, "/"),
  cover: (id: string, version: number) =>
    convertFileSrc(`cover/${id}`, "bookfile").replace(/%2F/gi, "/") + `?v=${version}`,
};

export const api = {
  // documents
  listDocuments: () => call<Document[]>("list_documents"),
  getDocument: (id: string) => call<Document>("get_document", { id }),
  importPaths: (paths: string[], collectionId?: string | null) =>
    call<{ jobId: string; total: number }>("import_paths", { paths, collectionId: collectionId ?? null }),
  finalizePdfImport: (
    id: string,
    meta: { title?: string; author?: string; description?: string; published?: string; pageCount: number },
    coverJpeg: number[] | null,
  ) => call<Document>("finalize_pdf_import", { id, meta, coverJpeg }),
  indexDocumentText: (id: string, chunks: TextChunk[], reset: boolean, done: boolean, ocr = false) =>
    call<void>("index_document_text", { id, chunks, reset, done, ocr }),
  updateDocuments: (ids: string[], patch: DocumentPatch) => call<Document[]>("update_documents", { ids, patch }),
  removeDocuments: (ids: string[], deleteFiles: boolean) =>
    call<{ removed: number; trashed: number; failed: string[] }>("remove_documents", { ids, deleteFiles }),
  setCoverFromFile: (id: string, path: string) => call<Document>("set_cover_from_file", { id, path }),
  setCoverImage: (id: string, bytes: number[]) => call<Document>("set_cover_image", { id, bytes }),
  relinkDocument: (id: string, path: string, force: boolean) =>
    call<{ document: Document | null; hashMatches: boolean }>("relink_document", { id, path, force }),
  checkMissingFiles: () => call<number>("check_missing_files"),
  revealDocument: (id: string) => call<void>("reveal_document", { id }),
  readTextDocument: (id: string) => call<string>("read_text_document", { id }),

  // collections & tags
  listCollections: () => call<Collection[]>("list_collections"),
  createCollection: (input: { name: string; parentId?: string | null; description?: string; icon?: string; color?: string }) =>
    call<Collection>("create_collection", { input: { parentId: null, ...input } }),
  updateCollection: (
    id: string,
    patch: { name?: string; description?: string; icon?: string; color?: string; parentId?: string | null },
  ) => call<Collection>("update_collection", { id, patch }),
  deleteCollection: (id: string) => call<void>("delete_collection", { id }),
  setDocumentCollections: (documentId: string, collectionIds: string[]) =>
    call<void>("set_document_collections", { documentId, collectionIds }),
  addDocumentsToCollection: (documentIds: string[], collectionId: string) =>
    call<void>("add_documents_to_collection", { documentIds, collectionId }),
  removeDocumentsFromCollection: (documentIds: string[], collectionId: string) =>
    call<void>("remove_documents_from_collection", { documentIds, collectionId }),
  listTags: () => call<Tag[]>("list_tags"),
  createTag: (name: string, color?: string) => call<Tag>("create_tag", { name, color: color ?? null }),
  updateTag: (id: string, name?: string, color?: string) =>
    call<Tag>("update_tag", { id, name: name ?? null, color: color ?? null }),
  deleteTag: (id: string) => call<void>("delete_tag", { id }),
  setDocumentTags: (documentId: string, tagIds: string[]) => call<void>("set_document_tags", { documentId, tagIds }),
  addTagToDocuments: (documentIds: string[], tagId: string) => call<void>("add_tag_to_documents", { documentIds, tagId }),
  setNoteTags: (noteId: string, tagIds: string[]) => call<void>("set_note_tags", { noteId, tagIds }),

  // annotations
  listHighlights: (documentId?: string) => call<Highlight[]>("list_highlights", { documentId: documentId ?? null }),
  createHighlight: (input: {
    documentId: string;
    locator: string;
    label: string | null;
    anchor: Anchor;
    text: string;
    color: HighlightColor;
    comment?: string | null;
    sortKey: number;
  }) => call<Highlight>("create_highlight", { input }),
  updateHighlight: (id: string, color?: HighlightColor, comment?: string) =>
    call<Highlight>("update_highlight", { id, color: color ?? null, comment: comment ?? null }),
  deleteHighlight: (id: string) => call<void>("delete_highlight", { id }),
  listBookmarks: (documentId: string) => call<Bookmark[]>("list_bookmarks", { documentId }),
  createBookmark: (input: { documentId: string; locator: string; label: string; description?: string | null; sortKey: number }) =>
    call<Bookmark>("create_bookmark", { input }),
  updateBookmark: (id: string, label?: string, description?: string) =>
    call<Bookmark>("update_bookmark", { id, label: label ?? null, description: description ?? null }),
  deleteBookmark: (id: string) => call<void>("delete_bookmark", { id }),

  // notes
  listNotes: (documentId?: string) => call<Note[]>("list_notes", { documentId: documentId ?? null }),
  createNote: (input: { documentId?: string | null; highlightId?: string | null; title: string; body: string }) =>
    call<Note>("create_note", { input: { documentId: null, highlightId: null, ...input } }),
  updateNote: (id: string, patch: { title?: string; body?: string; pinned?: boolean; documentId?: string | null }) =>
    call<Note>("update_note", { id, patch }),
  deleteNote: (id: string) => call<void>("delete_note", { id }),

  // reading
  getReadingPosition: (documentId: string) => call<ReadingPosition | null>("get_reading_position", { documentId }),
  saveReadingPosition: (documentId: string, locator: string, progress: number) =>
    call<void>("save_reading_position", { documentId, locator, progress }),
  markDocumentOpened: (documentId: string) => call<void>("mark_document_opened", { documentId }),
  recordReadingSession: (s: { documentId: string; startedAt: number; endedAt: number; activeSeconds: number; pagesRead: number }) =>
    call<void>("record_reading_session", s),
  cacheGet: (documentId: string, key: string) => call<string | null>("cache_get", { documentId, key }),
  cacheSet: (documentId: string, key: string, value: string) => call<void>("cache_set", { documentId, key, value }),

  // search & stats
  search: (query: string, limit = 20) => call<SearchResults>("search", { query, limit }),
  searchInDocument: (documentId: string, query: string) => call<ContentHit[]>("search_in_document", { documentId, query }),
  getStats: (days = 30) => call<Stats>("get_stats", { days }),
  readingHistory: (limit = 300, before?: number) => call<HistoryEntry[]>("reading_history", { limit, before: before ?? null }),

  // settings & data
  getSettings: () => call<Record<string, unknown>>("get_settings"),
  setSetting: (key: string, value: unknown) => call<void>("set_setting", { key, value }),
  libraryInfo: () => call<LibraryInfo>("library_info"),
  writeExport: (path: string, contents: string) => call<void>("write_export", { path, contents }),
  createBackup: (path: string) => call<number>("create_backup", { path }),
  restoreBackup: (path: string) => call<void>("restore_backup", { path }),
  runMaintenance: () =>
    call<{ integrity: string; sizeBefore: number; sizeAfter: number; orphanCoversRemoved: number; orphanFilesRemoved: number }>("run_maintenance"),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
