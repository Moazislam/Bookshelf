import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Ellipsis, Folder, FolderPlus, Layers, Pencil, Plus, Trash, Upload } from "lucide-react";
import { toast } from "sonner";
import { ask } from "@tauri-apps/plugin-dialog";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, Switch } from "@/components/ui";
import { CollectionDialog } from "@/components/library/CollectionDialog";
import { DocumentCover } from "@/components/library/DocumentCover";
import { LibraryView } from "@/components/library/LibraryView";
import { useBreadcrumbs } from "@/hooks";
import { useLibrary } from "@/stores/library";
import { api, errorMessage } from "@/services/api";
import { pickAndImportFiles } from "@/features/documents/importer";
import { swatch } from "@/utils";
import type { Collection } from "@/types";

function CollectionCard({ c }: { c: Collection }) {
  const documents = useLibrary((s) => s.documents);
  const collections = useLibrary((s) => s.collections);
  const docs = useMemo(() => documents.filter((d) => d.collectionIds.includes(c.id)).slice(0, 3), [documents, c.id]);
  const children = collections.filter((x) => x.parentId === c.id).length;
  return (
    <Link to={`/collections/${c.id}`} className="group flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative mb-4 flex h-28 items-end justify-center overflow-hidden rounded-lg" style={{ background: `color-mix(in srgb, ${swatch(c.color)} 16%, var(--surface-2))` }}>
        {docs.length ? (
          <div className="flex translate-y-3 items-end -space-x-5">
            {docs.map((d, i) => (
              <div key={d.id} style={{ transform: `rotate(${(i - (docs.length - 1) / 2) * 6}deg)`, zIndex: 3 - Math.abs(i - 1) }}>
                <DocumentCover doc={d} small className="h-24 w-16 rounded-[4px] shadow-md ring-2 ring-surface" />
              </div>
            ))}
          </div>
        ) : (
          <Folder className="mb-9 size-8" style={{ color: swatch(c.color) }} />
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: swatch(c.color) }} />
        <h3 className="truncate font-semibold">{c.name}</h3>
      </div>
      <p className="mt-0.5 text-[12px] text-muted">
        {c.documentCount} {c.documentCount === 1 ? "document" : "documents"}
        {children > 0 && ` · ${children} sub-collection${children > 1 ? "s" : ""}`}
      </p>
    </Link>
  );
}

export function CollectionsPage() {
  useBreadcrumbs([{ label: "Collections" }]);
  const collections = useLibrary((s) => s.collections);
  const [open, setOpen] = useState(false);
  const top = collections.filter((c) => !c.parentId);
  return (
    <div className="px-4 md:px-8 py-7">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-serif text-[28px] font-semibold">Collections</h1>
          <p className="mt-1 text-[13px] text-muted">Shelves for your documents. A document can sit on as many shelves as you like.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus /> New collection
        </Button>
      </div>
      {top.length === 0 ? (
        <EmptyState icon={Layers} title="No collections yet" description="Create collections like “Thesis research” or “Science fiction” and nest them as deep as you need." action={<Button variant="primary" onClick={() => setOpen(true)}><Plus /> Create your first collection</Button>} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {top.map((c) => <CollectionCard key={c.id} c={c} />)}
        </div>
      )}
      <CollectionDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function CollectionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const collections = useLibrary((s) => s.collections);
  const refresh = useLibrary((s) => s.refreshCollections);
  const c = collections.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [sub, setSub] = useState(false);
  const [includeSub, setIncludeSub] = useState(true);

  const path = useMemo(() => {
    const out: Collection[] = [];
    let cur = c;
    while (cur) {
      out.unshift(cur);
      cur = collections.find((x) => x.id === cur!.parentId);
    }
    return out;
  }, [c, collections]);
  useBreadcrumbs([{ label: "Collections", to: "/collections" }, ...path.map((p) => ({ label: p.name, to: `/collections/${p.id}` }))]);

  if (!c) {
    return <EmptyState icon={Layers} title="Collection not found" description="It may have been deleted." action={<Button onClick={() => navigate("/collections")}>Back to collections</Button>} />;
  }
  const children = collections.filter((x) => x.parentId === c.id);

  const remove = async () => {
    const ok = await ask(`Delete the collection “${c.name}”? Documents inside it stay in your library${children.length ? ", and sub-collections move up one level" : ""}.`, { title: "Delete collection", kind: "warning", okLabel: "Delete" });
    if (!ok) return;
    try {
      await api.deleteCollection(c.id);
      await refresh();
      await useLibrary.getState().refreshDocuments();
      toast.success(`Deleted “${c.name}”`);
      navigate(c.parentId ? `/collections/${c.parentId}` : "/collections");
    } catch (e) {
      toast.error("Could not delete collection", { description: errorMessage(e) });
    }
  };

  return (
    <>
      <div className="px-4 md:px-8 pb-2 pt-7">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${swatch(c.color)} 18%, var(--surface))` }}>
            <Folder className="size-5" style={{ color: swatch(c.color) }} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-[28px] font-semibold leading-tight">{c.name}</h1>
            {c.description && <p className="mt-1 max-w-2xl text-[13px] text-muted">{c.description}</p>}
          </div>
          <Button onClick={() => pickAndImportFiles(c.id)}>
            <Upload /> Import here
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" aria-label="Collection actions"><Ellipsis /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuItem onSelect={() => setEdit(true)}><Pencil /> Edit collection…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSub(true)}><FolderPlus /> New sub-collection…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem danger onSelect={remove}><Trash /> Delete collection</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {children.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {children.map((k) => (
              <Link key={k.id} to={`/collections/${k.id}`} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] shadow-sm hover:border-border-strong">
                <Folder className="size-3.5" style={{ color: swatch(k.color) }} />
                {k.name}
                <span className="text-[11px] text-subtle">{k.documentCount}</span>
                <ChevronRight className="size-3.5 text-subtle" />
              </Link>
            ))}
            <label className="ml-auto flex items-center gap-2 text-[12.5px] text-muted">
              <Switch checked={includeSub} onChange={setIncludeSub} label="Include sub-collections" /> Include sub-collections
            </label>
          </div>
        )}
      </div>
      <LibraryView
        key={c.id}
        preset={{ collectionId: c.id, includeSubcollections: includeSub }}
        emptyTitle="This collection is empty"
        emptyDescription="Add documents from their menu, select several in the library, or import directly into this collection."
      />
      <CollectionDialog open={edit} onOpenChange={setEdit} collection={c} />
      <CollectionDialog open={sub} onOpenChange={setSub} parentId={c.id} />
    </>
  );
}
