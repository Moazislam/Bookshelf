import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/services/api";
import { useLibrary } from "@/stores/library";
import { cn, SWATCHES } from "@/utils";
import type { Collection } from "@/types";

/** Collection names indented by depth, excluding `exclude` and its descendants. */
export function collectionOptions(collections: Collection[], exclude?: string) {
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of collections.filter((x) => x.parentId === parent)) {
      if (c.id === exclude) continue;
      out.push({ id: c.id, label: c.name, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function CollectionDialog({ open, onOpenChange, collection, parentId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; collection?: Collection; parentId?: string | null; onCreated?: (c: Collection) => void }) {
  const collections = useLibrary((s) => s.collections);
  const refresh = useLibrary((s) => s.refreshCollections);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("ember");
  const [parent, setParent] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(collection?.name ?? "");
      setDescription(collection?.description ?? "");
      setColor(collection?.color ?? "ember");
      setParent(collection?.parentId ?? parentId ?? "");
    }
  }, [open, collection, parentId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (collection) {
        await api.updateCollection(collection.id, { name, description, color, parentId: parent || null });
        toast.success("Collection updated");
      } else {
        const c = await api.createCollection({ name, description, color, parentId: parent || null });
        onCreated ? onCreated(c) : navigate(`/collections/${c.id}`);
        toast.success(`Created “${c.name}”`);
      }
      await refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save collection", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={collection ? "Edit collection" : "New collection"} description="Collections group documents. A document can live in many collections.">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Philosophy, Thesis research" maxLength={80} />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" className="min-h-16" />
          </Field>
          <Field label="Inside">
            <Select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">— Top level —</option>
              {collectionOptions(collections, collection?.id).map((o) => (
                <option key={o.id} value={o.id}>
                  {"  ".repeat(o.depth * 2)}
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Colour">
            <div className="flex gap-2">
              {Object.entries(SWATCHES).map(([k, v]) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setColor(k)}
                  aria-label={k}
                  className={cn("grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-surface transition", color === k && "ring-2 ring-fg/40")}
                  style={{ background: v }}
                >
                  {color === k && <Check className="size-3.5 text-white" />}
                </button>
              ))}
            </div>
          </Field>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={!name.trim() || busy}>
              {collection ? "Save" : "Create collection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
