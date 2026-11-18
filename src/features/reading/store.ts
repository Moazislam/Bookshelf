import { create } from "zustand";
import type { Anchor, Bookmark, Document, Highlight, HighlightColor } from "@/types";
import type { PDFDocumentProxy } from "@/services/pdf";

export interface TocItem {
  label: string;
  locator: string | null;
  children: TocItem[];
}

export interface ReaderLocation {
  locator: string; // persisted position
  progress: number; // 0..1
  label: string; // "Page 12 of 300" / chapter name
  page?: number; // 1-based page when meaningful
  total?: number;
  /** Key used for "pages read" statistics (distinct values per session). */
  readKey?: string;
}

export interface PendingSelection {
  text: string;
  anchor: Anchor;
  locator: string;
  label: string | null;
  sortKey: number;
  rect: { x: number; y: number; w: number; h: number }; // viewport coords
}

/** Imperative API each format engine registers with the shell. */
export interface ReaderEngine {
  goTo: (locator: string) => void;
  goToHighlight: (h: Highlight) => void;
  next: () => void;
  prev: () => void;
  clearSelection?: () => void;
  zoom?: (dir: 1 | -1 | 0) => void;
  /** Current position as a bookmark locator + label. */
  bookmarkTarget: () => { locator: string; label: string; sortKey: number } | null;
}

interface ReaderState {
  doc: Document | null;
  highlights: Highlight[];
  bookmarks: Bookmark[];
  toc: TocItem[];
  location: ReaderLocation | null;
  selection: PendingSelection | null;
  activeHighlight: { id: string; rect: PendingSelection["rect"] } | null;
  engine: ReaderEngine | null;
  pdf: PDFDocumentProxy | null;
  findQuery: string;
  lastColor: HighlightColor;
  reset: (doc: Document | null) => void;
  set: (p: Partial<ReaderState>) => void;
}

export const useReader = create<ReaderState>((set) => ({
  doc: null,
  highlights: [],
  bookmarks: [],
  toc: [],
  location: null,
  selection: null,
  activeHighlight: null,
  engine: null,
  pdf: null,
  findQuery: "",
  lastColor: "yellow",
  reset: (doc) => set({ doc, highlights: [], bookmarks: [], toc: [], location: null, selection: null, activeHighlight: null, engine: null, pdf: null, findQuery: "" }),
  set: (p) => set(p),
}));

export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "purple", "red"];

/** Solid swatch colours for UI chips (overlay colours live in CSS variables). */
export const HL_SWATCH: Record<HighlightColor, string> = {
  yellow: "#f2c94c",
  green: "#6fbf73",
  blue: "#5b9bd5",
  purple: "#a77bd6",
  red: "#e06c6c",
};

export function quoteFrom(full: string, start: number, end: number) {
  return { exact: full.slice(start, end), prefix: full.slice(Math.max(0, start - 32), start), suffix: full.slice(end, end + 32) };
}

/** Find `quote` in `text`, preferring the occurrence closest to `hint` and matching context. */
export function locateQuote(text: string, quote: { exact: string; prefix: string; suffix: string }, hint = 0): number {
  if (!quote.exact) return -1;
  let best = -1;
  let bestScore = -Infinity;
  let i = text.indexOf(quote.exact);
  let guard = 0;
  while (i !== -1 && guard++ < 500) {
    let score = -Math.abs(i - hint) / 1000;
    if (quote.prefix && text.slice(Math.max(0, i - quote.prefix.length), i) === quote.prefix) score += 10;
    if (quote.suffix && text.slice(i + quote.exact.length, i + quote.exact.length + quote.suffix.length) === quote.suffix) score += 10;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
    i = text.indexOf(quote.exact, i + 1);
  }
  return best;
}
