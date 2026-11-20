import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, ChevronDown, Pencil, Plus, ScanText, Search, StickyNote, Trash, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/services/api";
import { needsOcr, useOcr } from "@/services/ocr";
import { useReader, HL_SWATCH, type TocItem } from "./store";
import { PdfThumbnails } from "./engines/PdfEngine";
import { ComicThumbnails } from "./engines/ComicEngine";
import { Button, EmptyState, Input, Progress, Spinner } from "@/components/ui";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { TagChip } from "@/components/library/TagPicker";
import { useDocDialogs } from "@/components/library/DocumentDialogs";
import { useLibrary } from "@/stores/library";
import { useDebouncedValue } from "@/hooks";
import { cn, formatBytes, formatDate, FORMAT_LABEL, relativeTime, snippetParts, STATUS_LABEL } from "@/utils";
import type { ContentHit, HighlightColor, Note } from "@/types";

// ---------------------------------------------------------------------------
// Resizable side panel
// ---------------------------------------------------------------------------

export function SidePanel({ side, open, children, storageKey }: { side: "left" | "right"; open: boolean; children: React.ReactNode; storageKey: string }) {
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(storageKey)) || (side === "left" ? 280 : 340);
    } catch {
      return side === "left" ? 280 : 340;
    }
  });
  const dragging = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX, startW = width;
    const move = (ev: PointerEvent) => {
      const d = side === "left" ? ev.clientX - startX : startX - ev.clientX;
      setWidth(Math.min(560, Math.max(220, startW + d)));
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidth((w) => {
        try {
          localStorage.setItem(storageKey, String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  if (!open) return null;
  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col bg-sidebar",
        side === "left" ? "border-r border-border" : "border-l border-border",
        // Phones: float over the page instead of squeezing it.
        "max-md:absolute max-md:inset-y-0 max-md:z-30 max-md:w-[88vw]! max-md:shadow-lg",
        side === "left" ? "max-md:left-0" : "max-md:right-0",
      )}
      style={{ width }}
    >
      {children}
      <div
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        className={cn("absolute inset-y-0 z-10 w-1.5 cursor-col-resize hover:bg-accent/30 active:bg-accent/40", side === "left" ? "-right-[3px]" : "-left-[3px]")}
      />
    </aside>
  );
}

function PanelTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-1.5 pt-2 [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn("relative h-8 shrink-0 rounded-t-md px-2 text-[13px] font-medium transition-colors", value === t.value ? "text-fg" : "text-subtle hover:text-muted")}
        >
          {t.label}
          {t.count ? <span className="ml-1.5 text-[11px] text-subtle">{t.count}</span> : null}
          {value === t.value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left panel: contents, pages, bookmarks, search
// ---------------------------------------------------------------------------

function TocTree({ items, depth, current }: { items: TocItem[]; depth: number; current?: string }) {
  const engine = useReader((s) => s.engine);
  return (
    <ul>
      {items.map((it, i) => (
        <TocNode key={i} item={it} depth={depth} engine={engine} current={current} />
      ))}
    </ul>
  );
}

function TocNode({ item, depth, engine, current }: { item: TocItem; depth: number; engine: ReturnType<typeof useReader.getState>["engine"]; current?: string }) {
  const [open, setOpen] = useState(depth < 1);
  const isCurrent = current && item.label.trim() === current.trim();
  return (
    <li>
      <div className={cn("group flex items-center rounded-md hover:bg-bg-subtle", isCurrent && "bg-accent-soft")} style={{ paddingLeft: 6 + depth * 12 }}>
        {item.children.length ? (
          <button onClick={() => setOpen(!open)} className="grid size-5 shrink-0 place-items-center text-subtle" aria-label={open ? "Collapse" : "Expand"}>
            <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          disabled={!item.locator}
          onClick={() => item.locator && engine?.goTo(item.locator)}
          className={cn("min-w-0 flex-1 truncate py-1.5 pr-2 text-left text-[13px]", isCurrent ? "font-medium text-fg" : "text-muted group-hover:text-fg", !item.locator && "opacity-50")}
          title={item.label}
        >
          {item.label}
        </button>
      </div>
      {open && item.children.length > 0 && <TocTree items={item.children} depth={depth + 1} current={current} />}
    </li>
  );
}

function BookmarksTab() {
  const doc = useReader((s) => s.doc)!;
  const bookmarks = useReader((s) => s.bookmarks);
  const engine = useReader((s) => s.engine);
  const set = useReader((s) => s.set);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const add = async () => {
    const t = engine?.bookmarkTarget();
    if (!t) return;
    try {
      const b = await api.createBookmark({ documentId: doc.id, locator: t.locator, label: t.label, sortKey: t.sortKey });
      set({ bookmarks: [...bookmarks, b].sort((a, c) => a.sortKey - c.sortKey) });
    } catch (e) {
      toast.error("Could not add bookmark", { description: errorMessage(e) });
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <Button className="w-full" onClick={add}>
          <BookmarkPlus /> Bookmark this location
        </Button>
      </div>
      {bookmarks.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-subtle">No bookmarks yet. Press Ctrl+D to bookmark where you are.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {bookmarks.map((b) => (
            <li key={b.id} className="group rounded-md px-2 py-2 hover:bg-bg-subtle">
              {editing === b.id ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const updated = await api.updateBookmark(b.id, label);
                    set({ bookmarks: bookmarks.map((x) => (x.id === b.id ? updated : x)) });
                    setEditing(null);
                  }}
                >
                  <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => setEditing(null)} className="h-7 text-[13px]" />
                </form>
              ) : (
                <div className="flex items-start gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => engine?.goTo(b.locator)}>
                    <div className="line-clamp-2 text-[13px] font-medium">{b.label}</div>
                    <div className="text-[11px] text-subtle">{relativeTime(b.createdAt)}</div>
                  </button>
                  <div className="flex opacity-0 group-hover:opacity-100">
                    <Button variant="ghost" size="icon-sm" aria-label="Rename" onClick={() => { setEditing(b.id); setLabel(b.label); }}><Pencil /></Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete bookmark"
                      onClick={async () => {
                        await api.deleteBookmark(b.id);
                        set({ bookmarks: useReader.getState().bookmarks.filter((x) => x.id !== b.id) });
                      }}
                    >
                      <Trash />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchTab() {
  const doc = useReader((s) => s.doc)!;
  const engine = useReader((s) => s.engine);
  const findQuery = useReader((s) => s.findQuery);
  const set = useReader((s) => s.set);
  const [q, setQ] = useState(findQuery);
  const dq = useDebouncedValue(q.trim(), 220);
  const [hits, setHits] = useState<ContentHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  // The library copy is refreshed when OCR finishes; the reader's copy is not.
  const libDoc = useLibrary((s) => s.byId[doc.id]) ?? doc;
  const ocrJob = useOcr((s) => s.jobs[doc.id]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = () => inputRef.current?.focus();
    window.addEventListener("bookshelf:focus-find", on);
    return () => window.removeEventListener("bookshelf:focus-find", on);
  }, []);
  useEffect(() => setQ(findQuery), [findQuery]);
  useEffect(() => {
    set({ findQuery: dq });
    if (dq.length < 2) return setHits(null);
    let alive = true;
    setLoading(true);
    api
      .searchInDocument(doc.id, dq)
      .then((h) => alive && setHits(h))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dq, doc.id, set, libDoc.textSource]);

  const sorted = useMemo(() => {
    if (!hits) return null;
    return [...hits].sort((a, b) => (doc.format === "pdf" ? Number(a.locator) - Number(b.locator) : 0));
  }, [hits, doc.format]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative p-3">
        <Search className="pointer-events-none absolute left-5.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <Input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in document…" className="h-8 pl-8 pr-8" />
        {q && (
          <button className="absolute right-5 top-1/2 -translate-y-1/2 text-subtle hover:text-fg" onClick={() => setQ("")} aria-label="Clear search">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && <div className="flex justify-center py-4"><Spinner className="text-subtle" /></div>}
        {!doc.textIndexed && doc.format === "pdf" && <p className="px-3 py-2 text-[12px] text-warning">This PDF is still being indexed — results may be incomplete.</p>}
        {needsOcr(libDoc) && (
          <div className="px-3 py-4 text-center text-[13px] text-subtle">
            <p>{doc.format === "cbz" ? "This comic contains images only" : "This looks like a scanned book"}, so there is no text to search yet.</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => useOcr.getState().openDialog(doc.id)}>
              <ScanText /> {ocrJob ? `Recognising text… ${ocrJob.total ? Math.round((ocrJob.done / ocrJob.total) * 100) : 0}%` : "Recognise text (OCR)"}
            </Button>
          </div>
        )}
        {sorted && sorted.length === 0 && !loading && <p className="px-3 py-6 text-center text-[13px] text-subtle">No matches for “{dq}”.</p>}
        {sorted?.map((h, i) => (
          <button key={i} onClick={() => engine?.goTo(h.locator)} className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-bg-subtle">
            <div className="mb-0.5 text-[11px] font-medium text-subtle">{h.label ?? (doc.format === "pdf" ? `Page ${h.locator}` : "Match")}</div>
            <div className="line-clamp-3 text-[13px] text-muted">
              {snippetParts(h.snippet).map((p, j) => (p.hit ? <mark key={j} className="rounded-sm bg-accent-soft px-0.5 text-fg">{p.text}</mark> : <span key={j}>{p.text}</span>))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export type LeftTab = "contents" | "pages" | "bookmarks" | "search";

export function LeftPanel({ tab, setTab }: { tab: LeftTab; setTab: (t: LeftTab) => void }) {
  const doc = useReader((s) => s.doc)!;
  const toc = useReader((s) => s.toc);
  const bookmarks = useReader((s) => s.bookmarks);
  const location = useReader((s) => s.location);
  const engine = useReader((s) => s.engine);
  const hasPages = doc.format === "pdf" || doc.format === "cbz";
  const tabs: { value: LeftTab; label: string; count?: number }[] = [
    ...(doc.format !== "cbz" ? [{ value: "contents" as const, label: "Contents" }] : []),
    ...(hasPages ? [{ value: "pages" as const, label: "Pages" }] : []),
    { value: "bookmarks", label: "Bookmarks", count: bookmarks.length },
    { value: "search", label: "Search" },
  ];
  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;
  return (
    <>
      <PanelTabs value={current} onChange={setTab} tabs={tabs} />
      {current === "contents" &&
        (toc.length ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <TocTree items={toc} depth={0} current={location?.label} />
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-[13px] text-subtle">This document has no table of contents.</p>
        ))}
      {current === "pages" && doc.format === "pdf" && <div className="min-h-0 flex-1"><PdfThumbnails current={location?.page ?? 1} onPick={(p) => engine?.goTo(String(p))} /></div>}
      {current === "pages" && doc.format === "cbz" && <div className="min-h-0 flex-1"><ComicThumbnails doc={doc} current={location?.page ?? 1} onPick={(p) => engine?.goTo(String(p))} /></div>}
      {current === "bookmarks" && <BookmarksTab />}
      {current === "search" && <SearchTab />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Right panel: highlights, notes, info
// ---------------------------------------------------------------------------

function HighlightsTab() {
  const highlights = useReader((s) => s.highlights);
  const engine = useReader((s) => s.engine);
  const doc = useReader((s) => s.doc)!;
  const [filter, setFilter] = useState<HighlightColor | "all">("all");
  const shown = filter === "all" ? highlights : highlights.filter((h) => h.color === filter);
  if (doc.format === "cbz") return <EmptyState icon={StickyNote} title="No text to highlight" description="Comics are image-only. Use bookmarks and notes instead." className="py-10" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-3 py-2.5">
        <button onClick={() => setFilter("all")} className={cn("h-6 rounded-full px-2.5 text-[12px] font-medium", filter === "all" ? "bg-fg text-bg" : "text-muted hover:bg-bg-subtle")}>All</button>
        {(Object.keys(HL_SWATCH) as HighlightColor[]).map((c) => (
          <button key={c} onClick={() => setFilter(c)} aria-label={`Show ${c}`} className={cn("size-5 rounded-full border-2 border-sidebar", filter === c && "ring-2 ring-fg/40")} style={{ background: HL_SWATCH[c] }} />
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-subtle">{highlights.length ? "No highlights in this colour." : "Select text in the document to highlight it."}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {shown.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => engine?.goToHighlight(h)}
                className="group flex w-full gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-bg-subtle"
              >
                <span className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full" style={{ background: HL_SWATCH[h.color] }} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-4 font-reading text-[13px] leading-relaxed text-fg">{h.text}</span>
                  {h.comment && <span className="mt-1.5 block rounded-md bg-surface px-2 py-1.5 text-[12px] text-muted ring-1 ring-border">{h.comment}</span>}
                  <span className="mt-1 block text-[11px] text-subtle">{[h.label, relativeTime(h.createdAt)].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotesTab({ openNoteId, setOpenNoteId }: { openNoteId: string | null; setOpenNoteId: (id: string | null) => void }) {
  const doc = useReader((s) => s.doc)!;
  const [notes, setNotes] = useState<Note[] | null>(null);
  useEffect(() => {
    api.listNotes(doc.id).then(setNotes).catch(() => setNotes([]));
  }, [doc.id, openNoteId]);
  const open = notes?.find((n) => n.id === openNoteId);

  const create = async () => {
    const n = await api.createNote({ documentId: doc.id, title: "", body: "" });
    setNotes([n, ...(notes ?? [])]);
    setOpenNoteId(n.id);
  };

  if (open) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => setOpenNoteId(null)}>← All notes</Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto hover:text-danger"
            aria-label="Delete note"
            onClick={async () => {
              if (!window.confirm("Delete this note? This cannot be undone.")) return;
              await api.deleteNote(open.id);
              setOpenNoteId(null);
            }}
          >
            <Trash />
          </Button>
        </div>
        {open.highlightText && (
          <blockquote className="mx-3 mb-2 border-l-2 border-accent pl-3 font-reading text-[13px] italic text-muted line-clamp-4">{open.highlightText}</blockquote>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <NoteEditor key={open.id} note={open} compact autoFocus onSaved={(n) => setNotes((ns) => ns?.map((x) => (x.id === n.id ? n : x)) ?? ns)} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <Button className="w-full" onClick={create}><Plus /> New note</Button>
      </div>
      {notes === null ? (
        <div className="flex justify-center py-6"><Spinner className="text-subtle" /></div>
      ) : notes.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-subtle">Notes you write about this document live here and in your Notes workspace.</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {notes.map((n) => (
            <li key={n.id}>
              <button onClick={() => setOpenNoteId(n.id)} className="w-full rounded-md px-2.5 py-2 text-left hover:bg-bg-subtle">
                <div className="truncate text-[13px] font-medium">{n.title || "Untitled note"}</div>
                <div className="line-clamp-2 text-[12px] text-muted">{n.body.replace(/[#>*_`\-[\]]/g, "").slice(0, 160) || "Empty"}</div>
                <div className="mt-0.5 text-[11px] text-subtle">{relativeTime(n.updatedAt)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InfoTab() {
  const doc = useReader((s) => s.doc)!;
  const live = useLibrary((s) => s.byId[doc.id]) ?? doc;
  const tags = useLibrary((s) => s.tags);
  const collections = useLibrary((s) => s.collections);
  const location = useReader((s) => s.location);
  const openEdit = useDocDialogs((s) => s.openEdit);
  const rows: [string, React.ReactNode][] = [
    ["Author", live.author || "Unknown"],
    ["Format", FORMAT_LABEL[live.format]],
    ["Status", STATUS_LABEL[live.status]],
    [live.format === "epub" ? "Sections" : "Pages", live.pageCount ?? "—"],
    ["Size", formatBytes(live.fileSize)],
    ["Publisher", live.publisher || "—"],
    ["Published", live.published || "—"],
    ["Added", formatDate(live.addedAt)],
    ["Last opened", relativeTime(live.openedAt)],
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <h3 className="font-serif text-[18px] font-medium leading-snug">{live.title}</h3>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[12px] text-subtle">
          <span>Progress</span>
          <span>{Math.round((location?.progress ?? live.progress) * 100)}%</span>
        </div>
        <Progress value={location?.progress ?? live.progress} />
      </div>
      {live.description && <p className="mt-4 text-[13px] leading-relaxed text-muted">{live.description}</p>}
      <dl className="mt-4 divide-y divide-border text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-1.5">
            <dt className="text-subtle">{k}</dt>
            <dd className="truncate text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {live.tagIds.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {live.tagIds.map((id) => {
            const t = tags.find((x) => x.id === id);
            return t ? <TagChip key={id} name={t.name} color={t.color} /> : null;
          })}
        </div>
      )}
      {live.collectionIds.length > 0 && (
        <p className="mt-3 text-[12px] text-muted">In {live.collectionIds.map((id) => collections.find((c) => c.id === id)?.name).filter(Boolean).join(", ")}</p>
      )}
      <p className="selectable mt-4 break-all text-[11px] text-subtle">{live.path}</p>
      <Button className="mt-4 w-full" onClick={() => openEdit(live.id)}><Pencil /> Edit details</Button>
    </div>
  );
}

export type RightTab = "highlights" | "notes" | "info";

export function RightPanel({ tab, setTab, openNoteId, setOpenNoteId }: { tab: RightTab; setTab: (t: RightTab) => void; openNoteId: string | null; setOpenNoteId: (id: string | null) => void }) {
  const count = useReader((s) => s.highlights.length);
  return (
    <>
      <PanelTabs value={tab} onChange={setTab} tabs={[{ value: "highlights", label: "Highlights", count }, { value: "notes", label: "Notes" }, { value: "info", label: "Info" }]} />
      {tab === "highlights" && <HighlightsTab />}
      {tab === "notes" && <NotesTab openNoteId={openNoteId} setOpenNoteId={setOpenNoteId} />}
      {tab === "info" && <InfoTab />}
    </>
  );
}

