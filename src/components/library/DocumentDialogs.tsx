import { useEffect, useState } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { ImagePlus, TriangleExclamationPoint } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Select, Switch, Textarea } from "@/components/ui";
import { DocumentCover } from "./DocumentCover";
import { TagPicker } from "./TagPicker";
import { collectionOptions } from "./CollectionDialog";
import { useLibrary, refreshLibrary } from "@/stores/library";
import { api, errorMessage } from "@/services/api";
import { changeCover, removeDocuments } from "@/features/documents/actions";
import { cn, formatBytes, formatDate, FORMAT_LABEL, STATUSES, STATUS_LABEL, swatch } from "@/utils";
import type { ReadingStatus } from "@/types";

interface DialogState {
  editId: string | null;
  removeIds: string[];
  openEdit: (id: string) => void;
  openRemove: (ids: string[]) => void;
  close: () => void;
}
export const useDocDialogs = create<DialogState>((set) => ({
  editId: null,
  removeIds: [],
  openEdit: (editId) => set({ editId }),
  openRemove: (removeIds) => set({ removeIds }),
  close: () => set({ editId: null, removeIds: [] }),
}));

function EditDocumentDialog() {
  const id = useDocDialogs((s) => s.editId);
  const close = useDocDialogs((s) => s.close);
  const doc = useLibrary((s) => (id ? s.byId[id] : undefined));
  const collections = useLibrary((s) => s.collections);
  const [form, setForm] = useState({ title: "", author: "", description: "", publisher: "", published: "", language: "", status: "unread" as ReadingStatus });
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (doc) {
      setForm({
        title: doc.title,
        author: doc.author ?? "",
        description: doc.description ?? "",
        publisher: doc.publisher ?? "",
        published: doc.published ?? "",
        language: doc.language ?? "",
        status: doc.status,
      });
      setTagIds(doc.tagIds);
      setCollectionIds(doc.collectionIds);
    }
    // only when the dialog opens for a document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!doc) return null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await api.updateDocuments([doc.id], form);
      await api.setDocumentTags(doc.id, tagIds);
      await api.setDocumentCollections(doc.id, collectionIds);
      await refreshLibrary();
      toast.success("Details saved");
      close();
    } catch (err) {
      toast.error("Could not save", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent title="Edit details" wide>
        <form onSubmit={save} className="grid grid-cols-[150px_1fr] gap-6">
          <div className="flex flex-col gap-2">
            <DocumentCover doc={doc} className="aspect-[2/3] w-full rounded-md shadow-md" />
            <Button size="sm" onClick={() => changeCover(doc)}>
              <ImagePlus /> Change cover
            </Button>
            <dl className="mt-2 space-y-1.5 text-[11.5px] text-muted">
              <div><dt className="text-subtle">Format</dt><dd>{FORMAT_LABEL[doc.format]}</dd></div>
              <div><dt className="text-subtle">Size</dt><dd>{formatBytes(doc.fileSize)}</dd></div>
              {doc.pageCount != null && <div><dt className="text-subtle">{doc.format === "epub" ? "Sections" : "Pages"}</dt><dd>{doc.pageCount}</dd></div>}
              <div><dt className="text-subtle">Added</dt><dd>{formatDate(doc.addedAt)}</dd></div>
              <div><dt className="text-subtle">File</dt><dd className="break-all selectable">{doc.path}</dd></div>
            </dl>
          </div>
          <div className="flex flex-col gap-3.5">
            <Field label="Title">
              <Input value={form.title} onChange={set("title")} autoFocus />
            </Field>
            <Field label="Author">
              <Input value={form.author} onChange={set("author")} placeholder="Unknown" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Publisher"><Input value={form.publisher} onChange={set("publisher")} /></Field>
              <Field label="Published"><Input value={form.published} onChange={set("published")} placeholder="YYYY" /></Field>
              <Field label="Language"><Input value={form.language} onChange={set("language")} placeholder="en" /></Field>
            </div>
            <Field label="Description">
              <Textarea value={form.description} onChange={set("description")} className="min-h-24" />
            </Field>
            <Field label="Reading status">
              <Select value={form.status} onChange={set("status")}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tags">
              <TagPicker value={tagIds} onChange={setTagIds} />
            </Field>
            <Field label="Collections">
              {collections.length === 0 ? (
                <p className="text-[12.5px] text-subtle">No collections yet.</p>
              ) : (
                <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                  {collectionOptions(collections).map((c) => {
                    const on = collectionIds.includes(c.id);
                    const col = collections.find((x) => x.id === c.id)!;
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => setCollectionIds(on ? collectionIds.filter((x) => x !== c.id) : [...collectionIds, c.id])}
                        className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors", on ? "border-accent/40 bg-accent-soft text-fg" : "border-border text-muted hover:text-fg")}
                      >
                        <span className="size-2 rounded-full" style={{ background: swatch(col.color) }} />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
            <DialogFooter>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>Save changes</Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDocumentsDialog() {
  const ids = useDocDialogs((s) => s.removeIds);
  const close = useDocDialogs((s) => s.close);
  const byId = useLibrary((s) => s.byId);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDeleteFiles(false), [ids]);
  if (!ids.length) return null;
  const docs = ids.map((i) => byId[i]).filter(Boolean);
  const annotations = docs.reduce((n, d) => n + d.highlightCount, 0);
  const single = docs.length === 1 ? docs[0] : null;

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent title={single ? `Remove “${single.title}”?` : `Remove ${docs.length} documents?`}>
        <div className="space-y-4 text-[13px]">
          <p className="text-muted">
            {single ? "It" : "They"} will be removed from your library together with {annotations ? `${annotations} highlight${annotations === 1 ? "" : "s"}, ` : ""}bookmarks and reading progress. Notes are kept as standalone notes.
          </p>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <Switch checked={deleteFiles} onChange={setDeleteFiles} label="Also move files to the Recycle Bin" />
            <span>
              <span className="font-medium">Also move the original file{docs.length > 1 ? "s" : ""} to the Recycle Bin</span>
              <span className="block text-[12px] text-muted">Off by default — your files stay where they are.</span>
            </span>
          </label>
          {deleteFiles && (
            <p className="flex items-center gap-2 text-[12.5px] text-warning">
              <TriangleExclamationPoint className="size-4" /> The file{docs.length > 1 ? "s" : ""} can be restored from the Recycle Bin.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await removeDocuments(ids, deleteFiles);
              setBusy(false);
              close();
            }}
          >
            {deleteFiles ? "Remove and delete files" : "Remove from library"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentDialogs() {
  return (
    <>
      <EditDocumentDialog />
      <RemoveDocumentsDialog />
    </>
  );
}
