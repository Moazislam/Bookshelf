export type DocFormat = "pdf" | "epub" | "txt" | "md" | "cbz";
export type ReadingStatus = "unread" | "reading" | "completed" | "on_hold" | "abandoned";
export type HighlightColor = "yellow" | "green" | "blue" | "purple" | "red";

export interface Document {
  id: string;
  path: string;
  format: DocFormat;
  fileName: string;
  title: string;
  author: string | null;
  description: string | null;
  publisher: string | null;
  published: string | null;
  language: string | null;
  fileSize: number;
  pageCount: number | null;
  hasCover: boolean;
  status: ReadingStatus;
  favorite: boolean;
  progress: number;
  addedAt: number;
  openedAt: number | null;
  updatedAt: number;
  missing: boolean;
  metadataReady: boolean;
  textIndexed: boolean;
  /** Where the searchable text came from; "none" means a scanned book with no text layer. */
  textSource: "native" | "ocr" | "none" | null;
  tagIds: string[];
  collectionIds: string[];
  highlightCount: number;
  noteCount: number;
}

export interface DocumentPatch {
  title?: string;
  author?: string;
  description?: string;
  publisher?: string;
  published?: string;
  language?: string;
  status?: ReadingStatus;
  favorite?: boolean;
}

export interface Collection {
  id: string;
  parentId: string | null;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  sortOrder: number;
  createdAt: number;
  documentCount: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  documentCount: number;
  noteCount: number;
}

/** Format-specific information needed to restore a highlight exactly. */
export type Anchor =
  | {
      kind: "pdf";
      page: number; // 1-based
      rects: { x: number; y: number; w: number; h: number }[]; // normalised 0..1 page space
      quote: TextQuote;
      start?: number; // char offset in page text
    }
  | { kind: "epub"; cfi: string; quote: TextQuote; href?: string }
  | { kind: "text"; start: number; end: number; quote: TextQuote };

export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight {
  id: string;
  documentId: string;
  documentTitle: string;
  documentFormat: DocFormat;
  locator: string;
  label: string | null;
  anchor: Anchor;
  text: string;
  color: HighlightColor;
  comment: string | null;
  sortKey: number;
  createdAt: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  documentId: string;
  locator: string;
  label: string;
  description: string | null;
  sortKey: number;
  createdAt: number;
}

export interface Note {
  id: string;
  documentId: string | null;
  documentTitle: string | null;
  highlightId: string | null;
  highlightText: string | null;
  title: string;
  body: string;
  pinned: boolean;
  tagIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ReadingPosition {
  documentId: string;
  locator: string;
  progress: number;
  updatedAt: number;
}

export interface ImportReport {
  jobId: string;
  imported: string[];
  relinked: string[];
  duplicates: ImportIssue[];
  errors: ImportIssue[];
  pdfPending: string[];
}
export interface ImportIssue {
  fileName: string;
  path: string;
  message: string;
  existingId: string | null;
}
export interface ImportProgress {
  jobId: string;
  index: number;
  total: number;
  fileName: string;
}

export interface ContentHit {
  documentId: string;
  documentTitle: string;
  format: DocFormat;
  locator: string;
  label: string | null;
  snippet: string;
}
export interface SearchResults {
  documents: Document[];
  content: ContentHit[];
  highlights: {
    id: string;
    documentId: string;
    documentTitle: string;
    locator: string;
    label: string | null;
    color: HighlightColor;
    snippet: string;
  }[];
  notes: { id: string; title: string; documentTitle: string | null; snippet: string }[];
}

export interface Stats {
  totals: {
    documents: number;
    completed: number;
    reading: number;
    unread: number;
    favorites: number;
    pagesRead: number;
    readingSeconds: number;
    sessions: number;
    highlights: number;
    notes: number;
    bookmarks: number;
    collections: number;
    totalSize: number;
  };
  activity: { date: string; seconds: number; pages: number; sessions: number }[];
  addedPerMonth: Bucket[];
  byFormat: Bucket[];
  byStatus: Bucket[];
  byCollection: Bucket[];
  streakDays: number;
}
export interface Bucket {
  key: string;
  count: number;
  seconds: number;
}

export interface HistoryEntry {
  id: number;
  documentId: string;
  documentTitle: string;
  format: DocFormat;
  hasCover: boolean;
  startedAt: number;
  endedAt: number;
  activeSeconds: number;
  pagesRead: number;
}

export interface LibraryInfo {
  dataDir: string;
  databasePath: string;
  databaseSize: number;
  coversSize: number;
  schemaVersion: number;
}

export interface TextChunk {
  locator: string;
  label?: string | null;
  text: string;
}
