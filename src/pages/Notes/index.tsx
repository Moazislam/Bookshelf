import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { save } from "@tauri-apps/plugin-dialog";
import { BookOpen, Download, FileText, Highlighter, Pin, PinOff, Plus, Search, StickyNote, Trash } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/services/api";
import { useBreadcrumbs, useAsync } from "@/hooks";
import { useLibrary } from "@/stores/library";
import { Button, EmptyState, Input, SegmentedControl, Select, Skeleton, Tooltip } from "@/components/ui";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { TagPicker } from "@/components/library/TagPicker";
import { HL_SWATCH } from "@/features/reading/store";
import { cn, formatDate, relativeTime } from "@/utils";
import type { Highlight, HighlightColor, Note } from "@/types";
import { highlightsToMarkdown, notesToMarkdown } from "@/features/annotations/export";

async function exportMarkdown(defaultName: string, contents: string) {
  const path = await save({ title: "Export as Markdown", defaultPath: defaultName, filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (!path) return;
  try {
    await api.writeExport(path, contents);
    toast.success("Exported", { description: path });
  } catch (e) {
    toast.error("Export failed", { description: errorMessage(e) });
  }
}

function NotesWorkspace() {
  const [params, setParams] = useSearchParams();
  const tags = useLibrary((s) => s.tags);
  const documents = useLibrary((s) => s.documents);
  const refreshTags = useLibrary((s) => s.refreshTags);
  const { data: notes, setData, loading, reload } = useAsync(() => api.listNotes(), []);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const selectedId = params.get("note");
  const selected = notes?.find((n) => n.id === selectedId) ?? null;

  const create = async () => {
    try {
      const n = await api.createNote({ title: "", body: "" });
      setData([n, ...(notes ?? [])]);
      setParams({ note: n.id });
    } catch (e) {
      toast.error("Could not create note", { description: errorMessage(e) });
    }
  };

  useEffect(() => {
    if (params.get("new") === "1" && notes) void create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("new"), !!notes]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (notes ?? []).filter((n) => (!tagFilter || n.tagIds.includes(tagFilter)) && (!ql || `${n.title} ${n.body} ${n.documentTitle ?? ""}`.toLowerCase().includes(ql)));
  }, [notes, q, tagFilter]);

  const replace = (n: Note) => setData((notes ?? []).map((x) => (x.id === n.id ? n : x)));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
      <div className="flex min-h-0 flex-col border-r border-border">
        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" className="h-8 pl-8" />
            </div>
            <Tooltip content="New note"><Button variant="primary" size="icon" className="size-8" onClick={create} aria-label="New note"><Plus /></Button></Tooltip>
          </div>
          <div className="flex gap-2">
            <Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="h-7 flex-1 text-[12px]">
              <option value="">All tags</option>
              {tags.filter((t) => t.noteCount > 0).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Tooltip content="Export notes to Markdown">
              <Button size="icon-sm" className="size-7" aria-label="Export notes" disabled={!filtered.length} onClick={() => exportMarkdown("notes.md", notesToMarkdown(filtered, tags))}><Download /></Button>
            </Tooltip>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading && !notes ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="m-1 h-16" />)
          ) : filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-subtle">{notes?.length ? "No notes match." : "No notes yet. Create one, or add notes while reading."}</p>
          ) : (
            filtered.map((n) => (
              <button
                key={n.id}
                onClick={() => setParams({ note: n.id })}
                className={cn("mb-0.5 block w-full rounded-lg px-3 py-2.5 text-left transition-colors", selectedId === n.id ? "bg-surface shadow-sm ring-1 ring-border" : "hover:bg-bg-subtle")}
              >
                <div className="flex items-center gap-1.5">
                  {n.pinned && <Pin className="size-3 shrink-0 text-accent" />}
                  <span className="truncate text-[13px] font-semibold">{n.title || "Untitled note"}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{n.body.replace(/[#>*_`[\]]/g, "").slice(0, 140) || "Empty note"}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-subtle">
                  <span>{relativeTime(n.updatedAt)}</span>
                  {n.documentTitle && <span className="truncate">· {n.documentTitle}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {selected ? (
          <div className="mx-auto flex max-w-3xl flex-col px-10 py-8">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <span>Created {formatDate(selected.createdAt)}</span>
              <span>·</span>
              <Select
                value={selected.documentId ?? ""}
                onChange={async (e) => replace(await api.updateNote(selected.id, { documentId: e.target.value || null }))}
                className="h-7 w-auto max-w-72 text-[12px]"
                aria-label="Linked document"
              >
                <option value="">Not linked to a document</option>
                {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </Select>
              {selected.documentId && (
                <Link to={`/read/${selected.documentId}${selected.highlightId ? `?hl=${selected.highlightId}` : ""}`} className="flex items-center gap-1 text-accent hover:underline">
                  <BookOpen className="size-3.5" /> Open
                </Link>
              )}
              <div className="ml-auto flex gap-1">
                <Tooltip content={selected.pinned ? "Unpin" : "Pin to top"}>
                  <Button variant="ghost" size="icon-sm" aria-label="Pin" onClick={async () => replace(await api.updateNote(selected.id, { pinned: !selected.pinned }))}>
                    {selected.pinned ? <PinOff /> : <Pin />}
                  </Button>
                </Tooltip>
                <Tooltip content="Export this note">
                  <Button variant="ghost" size="icon-sm" aria-label="Export note" onClick={() => exportMarkdown(`${selected.title || "note"}.md`, notesToMarkdown([selected], tags))}><Download /></Button>
                </Tooltip>
                <Tooltip content="Delete note">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete note"
                    className="hover:text-danger"
                    onClick={async () => {
                      if (!window.confirm(`Delete “${selected.title || "Untitled note"}”? This cannot be undone.`)) return;
                      await api.deleteNote(selected.id);
                      setParams({});
                      reload();
                      void refreshTags();
                    }}
                  >
                    <Trash />
                  </Button>
                </Tooltip>
              </div>
            </div>
            {selected.highlightText && (
              <blockquote className="mb-5 border-l-[3px] border-accent pl-4 font-reading text-[14px] italic leading-relaxed text-muted">{selected.highlightText}</blockquote>
            )}
            <div className="mb-4">
              <TagPicker
                value={selected.tagIds}
                onChange={async (ids) => {
                  await api.setNoteTags(selected.id, ids);
                  replace({ ...selected, tagIds: ids });
                  void refreshTags();
                }}
              />
            </div>
            <NoteEditor key={selected.id} note={selected} onSaved={replace} autoFocus={!selected.body} />
          </div>
        ) : (
          <EmptyState icon={StickyNote} title="Select a note" description="Or create a new one. Notes support headings, lists, checklists, quotes, links and code." action={<Button variant="primary" onClick={create}><Plus /> New note</Button>} className="h-full" />
        )}
      </div>
    </div>
  );
}

function HighlightsWorkspace() {
  const navigate = useNavigate();
  const documents = useLibrary((s) => s.documents);
  const { data, loading } = useAsync(() => api.listHighlights(), []);
  const [q, setQ] = useState("");
  const [color, setColor] = useState<HighlightColor | "">("");
  const [docId, setDocId] = useState("");

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data ?? []).filter((h) => (!color || h.color === color) && (!docId || h.documentId === docId) && (!ql || `${h.text} ${h.comment ?? ""}`.toLowerCase().includes(ql)));
  }, [data, q, color, docId]);

  const grouped = useMemo(() => {
    const m = new Map<string, Highlight[]>();
    for (const h of filtered) m.set(h.documentId, [...(m.get(h.documentId) ?? []), h]);
    return [...m.entries()];
  }, [filtered]);

  const docsWithHighlights = useMemo(() => {
    const ids = new Set((data ?? []).map((h) => h.documentId));
    return documents.filter((d) => ids.has(d.id));
  }, [data, documents]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border/60 bg-bg/90 px-4 md:px-8 py-3 backdrop-blur">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search highlights…" className="h-8 pl-8" />
        </div>
        <Select value={docId} onChange={(e) => setDocId(e.target.value)} className="h-8 w-56">
          <option value="">All documents</option>
          {docsWithHighlights.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </Select>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setColor("")} className={cn("h-6 rounded-full px-2.5 text-[11.5px] font-medium", !color ? "bg-fg text-bg" : "text-muted hover:bg-bg-subtle")}>All</button>
          {(Object.keys(HL_SWATCH) as HighlightColor[]).map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={c} className={cn("size-5 rounded-full border-2 border-bg", color === c && "ring-2 ring-fg/40")} style={{ background: HL_SWATCH[c] }} />
          ))}
        </div>
        <Button className="ml-auto h-8" disabled={!filtered.length} onClick={() => exportMarkdown("highlights.md", highlightsToMarkdown(filtered))}>
          <Download /> Export Markdown
        </Button>
      </div>
      <div className="mx-auto max-w-4xl px-4 md:px-8 py-6">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="mb-3 h-20" />)
        ) : grouped.length === 0 ? (
          <EmptyState icon={Highlighter} title={data?.length ? "No matching highlights" : "No highlights yet"} description="Select text while reading and pick a colour to highlight it. Every highlight appears here." />
        ) : (
          grouped.map(([documentId, items]) => (
            <section key={documentId} className="mb-8">
              <button onClick={() => navigate(`/read/${documentId}`)} className="mb-3 flex items-center gap-2 text-left hover:text-accent">
                <FileText className="size-4 text-subtle" />
                <h3 className="font-serif text-[17px] font-semibold">{items[0].documentTitle}</h3>
                <span className="text-[12px] text-subtle">{items.length}</span>
              </button>
              <div className="space-y-2">
                {items.map((h) => (
                  <button key={h.id} onClick={() => navigate(`/read/${h.documentId}?hl=${h.id}`)} className="flex w-full gap-3 rounded-lg border border-border bg-surface p-3.5 text-left shadow-sm transition-colors hover:border-border-strong">
                    <span className="w-1 shrink-0 rounded-full" style={{ background: HL_SWATCH[h.color] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-reading text-[14px] leading-relaxed">{h.text}</span>
                      {h.comment && <span className="mt-2 block text-[12.5px] text-muted">💬 {h.comment}</span>}
                      <span className="mt-1.5 block text-[11px] text-subtle">{[h.label, formatDate(h.createdAt)].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export function NotesPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "highlights" ? "highlights" : "notes";
  useBreadcrumbs([{ label: "Notes & Highlights" }]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between px-4 md:px-8 pb-4 pt-7">
        <div>
          <h1 className="font-serif text-[28px] font-semibold">Notes & Highlights</h1>
          <p className="mt-1 text-[13px] text-muted">Your thinking, connected to what you read.</p>
        </div>
        <SegmentedControl
          value={view}
          onChange={(v) => setParams(v === "highlights" ? { view: v } : {})}
          options={[
            { value: "notes", label: <><StickyNote /> Notes</> },
            { value: "highlights", label: <><Highlighter /> Highlights</> },
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-border">{view === "notes" ? <NotesWorkspace /> : <HighlightsWorkspace />}</div>
    </div>
  );
}


