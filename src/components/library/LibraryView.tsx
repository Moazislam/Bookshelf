import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpDown, BookOpen, CircleDot, FolderPlus, LayoutGrid, List, ListFilter, Search, Star, Tag, Trash, Upload, X } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Select,
  Skeleton,
} from "@/components/ui";
import { DocumentCard, DocumentRow } from "./DocumentCard";
import { useDocDialogs } from "./DocumentDialogs";
import { collectionOptions } from "./CollectionDialog";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { pickAndImportFiles } from "@/features/documents/importer";
import { addTag, addToCollection, setFavorite, setStatus } from "@/features/documents/actions";
import { cn, FORMAT_LABEL, STATUSES, STATUS_LABEL, swatch } from "@/utils";
import type { DocFormat, Document, ReadingStatus } from "@/types";

export interface Preset {
  status?: ReadingStatus;
  favorites?: boolean;
  collectionId?: string;
  includeSubcollections?: boolean;
}

type SortKey = "added" | "opened" | "title" | "author" | "progress" | "size";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "Recently added" },
  { key: "opened", label: "Recently opened" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "progress", label: "Reading progress" },
  { key: "size", label: "File size" },
];

interface Filters {
  formats: DocFormat[];
  statuses: ReadingStatus[];
  tagIds: string[];
  collectionId: string;
  author: string;
  added: "any" | "7" | "30" | "365";
  favorites: boolean;
}
const EMPTY: Filters = { formats: [], statuses: [], tagIds: [], collectionId: "", author: "", added: "any", favorites: false };

function compare(sort: SortKey, a: Document, b: Document) {
  switch (sort) {
    case "added": return b.addedAt - a.addedAt;
    case "opened": return (b.openedAt ?? 0) - (a.openedAt ?? 0);
    case "title": return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
    case "author": return (a.author ?? "￿").localeCompare(b.author ?? "￿", undefined, { sensitivity: "base" });
    case "progress": return b.progress - a.progress;
    case "size": return b.fileSize - a.fileSize;
  }
}

function descendants(collections: { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of collections) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
}

export function LibraryView({ preset = {}, emptyTitle, emptyDescription }: { preset?: Preset; emptyTitle?: string; emptyDescription?: string }) {
  const loaded = useLibrary((s) => s.loaded);
  const documents = useLibrary((s) => s.documents);
  const collections = useLibrary((s) => s.collections);
  const tags = useLibrary((s) => s.tags);
  const view = useSettings((s) => s.values["library.view"]);
  const sortSetting = useSettings((s) => s.values["library.sort"]);
  const setSetting = useSettings((s) => s.set);
  const openRemove = useDocDialogs((s) => s.openRemove);

  const [text, setText] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);
  const sort = (SORTS.some((s) => s.key === sortSetting) ? sortSetting : "added") as SortKey;

  const tagName = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t.name])), [tags]);
  const authors = useMemo(() => [...new Set(documents.map((d) => d.author).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)), [documents]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    const scope = preset.collectionId ? descendants(collections, preset.collectionId) : null;
    const filterCol = filters.collectionId ? descendants(collections, filters.collectionId) : null;
    const since = filters.added === "any" ? 0 : Date.now() - Number(filters.added) * 86400000;
    return documents
      .filter((d) => {
        if (preset.status && d.status !== preset.status) return false;
        if (preset.favorites && !d.favorite) return false;
        if (scope) {
          const ids = preset.includeSubcollections ? scope : new Set([preset.collectionId!]);
          if (!d.collectionIds.some((c) => ids.has(c))) return false;
        }
        if (filters.formats.length && !filters.formats.includes(d.format)) return false;
        if (filters.statuses.length && !filters.statuses.includes(d.status)) return false;
        if (filters.tagIds.length && !filters.tagIds.every((t) => d.tagIds.includes(t))) return false;
        if (filterCol && !d.collectionIds.some((c) => filterCol.has(c))) return false;
        if (filters.author && d.author !== filters.author) return false;
        if (filters.favorites && !d.favorite) return false;
        if (since && d.addedAt < since) return false;
        if (q) {
          const hay = `${d.title} ${d.author ?? ""} ${d.fileName} ${d.tagIds.map((t) => tagName[t]).join(" ")}`.toLowerCase();
          if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
        }
        return true;
      })
      .sort((a, b) => compare(sort, a, b));
  }, [documents, collections, preset, filters, text, sort, tagName]);

  // Drop selections that are no longer visible.
  useEffect(() => {
    setSelected((s) => {
      const visible = new Set(filtered.map((d) => d.id));
      const next = new Set([...s].filter((id) => visible.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [filtered]);

  const onSelect = useCallback(
    (id: string, e: React.MouseEvent) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (e.shiftKey && lastClicked.current) {
          const ids = filtered.map((d) => d.id);
          const [a, b] = [ids.indexOf(lastClicked.current), ids.indexOf(id)].sort((x, y) => x - y);
          if (a >= 0) ids.slice(a, b + 1).forEach((x) => next.add(x));
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastClicked.current = id;
    },
    [filtered],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set());
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !(e.target as HTMLElement).closest("input,textarea,[contenteditable]")) {
        e.preventDefault();
        setSelected(new Set(filtered.map((d) => d.id)));
      }
      if (e.key === "Delete" && selected.size && !(e.target as HTMLElement).closest("input,textarea,[contenteditable]")) openRemove([...selected]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selected, openRemove]);

  const activeFilters =
    filters.formats.length + filters.statuses.length + filters.tagIds.length + (filters.collectionId ? 1 : 0) + (filters.author ? 1 : 0) + (filters.added !== "any" ? 1 : 0) + (filters.favorites ? 1 : 0);
  const toggle = <K extends "formats" | "statuses" | "tagIds">(k: K, v: Filters[K][number]) =>
    setFilters((f) => ({ ...f, [k]: (f[k] as string[]).includes(v as string) ? (f[k] as string[]).filter((x) => x !== v) : [...(f[k] as string[]), v] }));

  const ids = [...selected];

  if (!loaded) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5 px-4 md:px-8 py-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="aspect-[2/3] w-full" />
            <Skeleton className="mt-3 h-3.5 w-4/5" />
            <Skeleton className="mt-1.5 h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border/60 bg-bg/90 px-4 md:px-8 py-3 backdrop-blur">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by title, author, tag…" className="h-8 pl-8" />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="md" className="h-8">
              <ListFilter /> Filters
              {activeFilters > 0 && <span className="grid size-4.5 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-fg">{activeFilters}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[440px] p-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
              <div>
                <div className="mb-2 text-[12px] font-medium text-subtle">Format</div>
                <div className="flex flex-wrap gap-1.5">
                  {(["pdf", "epub", "cbz", "txt", "md"] as DocFormat[]).map((f) => (
                    <Chip key={f} on={filters.formats.includes(f)} onClick={() => toggle("formats", f)}>{FORMAT_LABEL[f]}</Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[12px] font-medium text-subtle">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => (
                    <Chip key={s} on={filters.statuses.includes(s)} onClick={() => toggle("statuses", s)}>{STATUS_LABEL[s]}</Chip>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <div className="mb-2 text-[12px] font-medium text-subtle">Tags (match all)</div>
                {tags.length ? (
                  <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                    {tags.map((t) => (
                      <Chip key={t.id} on={filters.tagIds.includes(t.id)} onClick={() => toggle("tagIds", t.id)}>
                        <span className="size-1.5 rounded-full" style={{ background: swatch(t.color) }} />
                        {t.name}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-subtle">No tags yet.</p>
                )}
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-subtle">Author</span>
                <Select value={filters.author} onChange={(e) => setFilters({ ...filters, author: e.target.value })} className="h-8">
                  <option value="">Any author</option>
                  {authors.map((a) => <option key={a} value={a}>{a}</option>)}
                </Select>
              </label>
              {!preset.collectionId && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-subtle">Collection</span>
                  <Select value={filters.collectionId} onChange={(e) => setFilters({ ...filters, collectionId: e.target.value })} className="h-8">
                    <option value="">Any collection</option>
                    {collectionOptions(collections).map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth * 2)}{c.label}</option>)}
                  </Select>
                </label>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-subtle">Date added</span>
                <Select value={filters.added} onChange={(e) => setFilters({ ...filters, added: e.target.value as Filters["added"] })} className="h-8">
                  <option value="any">Any time</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="365">Last year</option>
                </Select>
              </label>
              {!preset.favorites && (
                <label className="flex items-end gap-2 pb-1.5">
                  <input type="checkbox" checked={filters.favorites} onChange={(e) => setFilters({ ...filters, favorites: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                  <span>Favorites only</span>
                </label>
              )}
            </div>
            {activeFilters > 0 && (
              <div className="mt-4 flex justify-end border-t border-border pt-3">
                <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>Clear all filters</Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="h-8">
              <ArrowUpDown /> {SORTS.find((s) => s.key === sort)?.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            {SORTS.map((s) => (
              <DropdownMenuCheckboxItem key={s.key} checked={sort === s.key} onSelect={() => setSetting("library.sort", s.key)}>
                {s.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-[12px] text-subtle">
          {filtered.length} {filtered.length === 1 ? "document" : "documents"}
        </span>
        <div className="ml-auto">
          <SegmentedControl
            size="sm"
            value={view}
            onChange={(v) => setSetting("library.view", v)}
            options={[
              { value: "grid", label: <LayoutGrid />, title: "Grid view" },
              { value: "list", label: <List />, title: "List view" },
            ]}
          />
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="sticky top-[57px] z-10 mx-4 md:mx-8 mt-3 flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 shadow-sm animate-slide-up">
          <span className="mr-2 text-[13px] font-medium">{selected.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><CircleDot /> Status</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {STATUSES.map((s) => <DropdownMenuItem key={s} onSelect={() => setStatus(ids, s)}>{STATUS_LABEL[s]}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" onClick={() => setFavorite(ids, !ids.every((i) => documents.find((d) => d.id === i)?.favorite))}><Star /> Favorite</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><FolderPlus /> Add to collection</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              {collections.length === 0 && <DropdownMenuItem disabled>No collections yet</DropdownMenuItem>}
              {collectionOptions(collections).map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => addToCollection(ids, c.id, c.label)}>
                  <span style={{ paddingLeft: c.depth * 12 }}>{c.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><Tag /> Tag</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              {tags.length === 0 && <DropdownMenuItem disabled>No tags yet</DropdownMenuItem>}
              {tags.map((t) => <DropdownMenuItem key={t.id} onSelect={() => addTag(ids, t.id)}>{t.name}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="mx-1 h-4 w-px bg-border-strong" />
          <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => openRemove(ids)}><Trash /> Remove</Button>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X /></Button>
        </div>
      )}

      {/* Content */}
      {filtered.length === 0 ? (
        documents.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Your library is empty"
            description="Drag PDFs, EPUBs, comics or text files anywhere in this window, or import them from your computer."
            action={<Button variant="primary" onClick={() => pickAndImportFiles(preset.collectionId)}><Upload /> Import documents</Button>}
          />
        ) : (
          <EmptyState
            icon={preset.favorites ? Star : BookOpen}
            title={text || activeFilters ? "No matches" : emptyTitle ?? "Nothing here yet"}
            description={text || activeFilters ? "Try a different search or clear your filters." : emptyDescription}
            action={text || activeFilters ? <Button onClick={() => { setText(""); setFilters(EMPTY); }}>Clear filters</Button> : preset.collectionId ? <Button onClick={() => pickAndImportFiles(preset.collectionId)}><Upload /> Import into this collection</Button> : undefined}
          />
        )
      ) : view === "grid" ? (
        <VirtualGrid docs={filtered} selected={selected} onSelect={onSelect} />
      ) : (
        <VirtualList docs={filtered} selected={selected} onSelect={onSelect} tagName={tagName} />
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors", on ? "border-accent/40 bg-accent-soft text-fg" : "border-border text-muted hover:text-fg")}>
      {children}
    </button>
  );
}

function useScrollParent() {
  return useCallback(() => document.getElementById("main-scroll"), []);
}

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function VirtualGrid({ docs, selected, onSelect }: { docs: Document[]; selected: Set<string>; onSelect: (id: string, e: React.MouseEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);
  const gap = 12;
  const minCard = 168;
  const cols = Math.max(2, Math.floor((width + gap) / (minCard + gap)));
  const cardW = width ? (width - gap * (cols - 1)) / cols : minCard;
  const rowH = cardW * 1.5 + 92;
  const rows = Math.ceil(docs.length / cols);
  const getScroll = useScrollParent();
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: getScroll,
    estimateSize: () => rowH,
    overscan: 3,
    scrollMargin: ref.current?.offsetTop ?? 0,
  });
  useEffect(() => virtualizer.measure(), [rowH, virtualizer]);
  const selecting = selected.size > 0;
  return (
    <div ref={ref} className="relative mx-4 md:mx-8 my-4" style={{ height: virtualizer.getTotalSize() }}>
      {width > 0 &&
        virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute inset-x-0 grid"
            style={{ top: row.start - virtualizer.options.scrollMargin, height: rowH, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: gap }}
          >
            {docs.slice(row.index * cols, row.index * cols + cols).map((d) => (
              <DocumentCard key={d.id} doc={d} selected={selected.has(d.id)} selecting={selecting} onSelect={onSelect} />
            ))}
          </div>
        ))}
    </div>
  );
}

function VirtualList({ docs, selected, onSelect, tagName }: { docs: Document[]; selected: Set<string>; onSelect: (id: string, e: React.MouseEvent) => void; tagName: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const getScroll = useScrollParent();
  const virtualizer = useVirtualizer({ count: docs.length, getScrollElement: getScroll, estimateSize: () => 56, overscan: 10, scrollMargin: ref.current?.offsetTop ?? 0 });
  const selecting = selected.size > 0;
  return (
    <div className="mx-4 md:mx-8 my-4 overflow-hidden rounded-lg border border-border bg-surface/50">
      <div className="grid h-9 grid-cols-[28px_minmax(0,3fr)_minmax(0,1.6fr)_80px_110px_110px_80px_32px] max-md:grid-cols-[28px_minmax(0,1fr)_32px] max-md:[&>*:nth-child(n+3):nth-child(-n+7)]:hidden items-center gap-3 border-b border-border bg-bg-subtle/60 px-3 text-[12px] font-medium text-subtle">
        <span />
        <span>Title</span>
        <span>Author</span>
        <span>Format</span>
        <span>Status</span>
        <span>Progress</span>
        <span className="text-right">Size</span>
        <span />
      </div>
      <div ref={ref} className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const d = docs[item.index];
          return (
            <DocumentRow
              key={d.id}
              doc={d}
              selected={selected.has(d.id)}
              selecting={selecting}
              onSelect={onSelect}
              tagNames={d.tagIds.map((t) => tagName[t]).filter(Boolean).join(" · ")}
              style={{ position: "absolute", top: item.start - virtualizer.options.scrollMargin, left: 0, right: 0 }}
            />
          );
        })}
      </div>
    </div>
  );
}
