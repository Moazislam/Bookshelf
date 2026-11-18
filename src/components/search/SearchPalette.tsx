import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { BookOpen, ChartColumn, FileText, Highlighter, LayoutDashboard, Layers, Library, Search, Settings, StickyNote, Upload } from "lucide-react";
import { api } from "@/services/api";
import { useUI } from "@/stores/ui";
import { useLibrary } from "@/stores/library";
import { useDebouncedValue } from "@/hooks";
import { cn, FORMAT_LABEL, snippetParts } from "@/utils";
import { Kbd, Spinner } from "@/components/ui";
import { DocumentCover } from "@/components/library/DocumentCover";
import { pickAndImportFiles } from "@/features/documents/importer";
import type { SearchResults } from "@/types";

function Snippet({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("line-clamp-2 text-[12.5px] text-muted", className)}>
      {snippetParts(text).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-0.5 font-medium text-fg">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

const itemCls =
  "flex cursor-default items-start gap-3 rounded-md px-2.5 py-2 text-[13px] data-[selected=true]:bg-bg-subtle aria-selected:bg-bg-subtle";
const groupCls =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle";

export function SearchPalette() {
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearchOpen);
  const byId = useLibrary((s) => s.byId);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query.trim(), 160);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!q) {
      setResults(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .search(q, 12)
      .then((r) => alive && setResults(r))
      .catch(() => alive && setResults(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const empty = results && !results.documents.length && !results.content.length && !results.highlights.length && !results.notes.length;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-48px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg data-[state=open]:animate-scale-in">
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search your library, notes and highlights</DialogPrimitive.Description>
          <Command shouldFilter={!q} loop className="flex max-h-[min(70vh,560px)] flex-col">
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="size-4 text-subtle" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search titles, authors, tags, full text, highlights and notes…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
                autoFocus
              />
              {loading && <Spinner className="size-3.5 text-subtle" />}
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {!q && (
                <>
                  <Command.Group heading="Go to" className={groupCls}>
                    {[
                      { label: "Dashboard", to: "/", icon: LayoutDashboard },
                      { label: "My Library", to: "/library", icon: Library },
                      { label: "Currently Reading", to: "/reading", icon: BookOpen },
                      { label: "Collections", to: "/collections", icon: Layers },
                      { label: "Notes & Highlights", to: "/notes", icon: Highlighter },
                      { label: "Statistics", to: "/stats", icon: ChartColumn },
                      { label: "Settings", to: "/settings", icon: Settings },
                    ].map((n) => (
                      <Command.Item key={n.to} value={n.label} onSelect={() => go(n.to)} className={cn(itemCls, "items-center")}>
                        <n.icon className="size-4 text-subtle" />
                        {n.label}
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Actions" className={groupCls}>
                    <Command.Item value="Import documents" onSelect={() => { setOpen(false); void pickAndImportFiles(); }} className={cn(itemCls, "items-center")}>
                      <Upload className="size-4 text-subtle" /> Import documents…
                    </Command.Item>
                    <Command.Item value="New note" onSelect={() => go("/notes?new=1")} className={cn(itemCls, "items-center")}>
                      <StickyNote className="size-4 text-subtle" /> New note
                    </Command.Item>
                  </Command.Group>
                </>
              )}
              {q && empty && !loading && (
                <div className="px-4 py-10 text-center text-[13px] text-muted">
                  No results for “{q}”.
                  <p className="mt-1 text-[12px] text-subtle">PDF text becomes searchable after it finishes indexing.</p>
                </div>
              )}
              {results && results.documents.length > 0 && (
                <Command.Group heading="Documents" className={groupCls}>
                  {results.documents.map((d) => (
                    <Command.Item key={d.id} value={`doc-${d.id}`} onSelect={() => go(`/read/${d.id}`)} className={itemCls}>
                      <DocumentCover doc={d} className="h-11 w-8 shrink-0 rounded-[3px]" small />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{d.title}</div>
                        <div className="truncate text-[12px] text-muted">
                          {d.author || "Unknown author"} · {FORMAT_LABEL[d.format]}
                        </div>
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {results && results.content.length > 0 && (
                <Command.Group heading="In documents" className={groupCls}>
                  {results.content.map((h, i) => (
                    <Command.Item
                      key={`${h.documentId}-${h.locator}-${i}`}
                      value={`content-${i}`}
                      onSelect={() => go(`/read/${h.documentId}?loc=${encodeURIComponent(h.locator)}&q=${encodeURIComponent(q)}`)}
                      className={itemCls}
                    >
                      <FileText className="mt-0.5 size-4 shrink-0 text-subtle" />
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-medium">
                          {h.documentTitle}
                          <span className="font-normal text-subtle"> · {h.label ?? (byId[h.documentId]?.format === "pdf" ? `Page ${h.locator}` : "Text")}</span>
                        </div>
                        <Snippet text={h.snippet} />
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {results && results.highlights.length > 0 && (
                <Command.Group heading="Highlights" className={groupCls}>
                  {results.highlights.map((h) => (
                    <Command.Item key={h.id} value={`hl-${h.id}`} onSelect={() => go(`/read/${h.documentId}?hl=${h.id}`)} className={itemCls}>
                      <span className={cn("mt-1 h-4 w-1 shrink-0 rounded-full", `hl-${h.color}`)} style={{ background: "var(--hl)" }} />
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-medium">
                          {h.documentTitle}
                          {h.label && <span className="font-normal text-subtle"> · {h.label}</span>}
                        </div>
                        <Snippet text={h.snippet} />
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {results && results.notes.length > 0 && (
                <Command.Group heading="Notes" className={groupCls}>
                  {results.notes.map((n) => (
                    <Command.Item key={n.id} value={`note-${n.id}`} onSelect={() => go(`/notes?note=${n.id}`)} className={itemCls}>
                      <StickyNote className="mt-0.5 size-4 shrink-0 text-subtle" />
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-medium">
                          {n.title || "Untitled note"}
                          {n.documentTitle && <span className="font-normal text-subtle"> · {n.documentTitle}</span>}
                        </div>
                        <Snippet text={n.snippet} />
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
