import { useNavigate } from "react-router-dom";
import { BookOpen, CircleDot, ExternalLink, FolderPlus, ImagePlus, Link, Pencil, ScanText, Star, Tag, Trash } from "lucide-react";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui";
import { useLibrary } from "@/stores/library";
import { useDocDialogs } from "./DocumentDialogs";
import { changeCover, relinkDocument, revealDocument, setStatus, toggleCollection, toggleFavorite } from "@/features/documents/actions";
import { api, isMobile } from "@/services/api";
import { needsOcr, useOcr } from "@/services/ocr";
import { refreshLibrary } from "@/stores/library";
import { collectionOptions } from "./CollectionDialog";
import { STATUSES, STATUS_LABEL, swatch } from "@/utils";
import type { Document } from "@/types";

/** Menu items for a single document, rendered as either a context menu or a dropdown. */
export function DocumentMenuItems({ doc, kind }: { doc: Document; kind: "context" | "dropdown" }) {
  const C = kind === "context"
    ? { Item: ContextMenuItem, Check: ContextMenuCheckboxItem, Sep: ContextMenuSeparator, Sub: ContextMenuSub, SubTrigger: ContextMenuSubTrigger, SubContent: ContextMenuSubContent }
    : { Item: DropdownMenuItem, Check: DropdownMenuCheckboxItem, Sep: DropdownMenuSeparator, Sub: DropdownMenuSub, SubTrigger: DropdownMenuSubTrigger, SubContent: DropdownMenuSubContent };
  const navigate = useNavigate();
  const collections = useLibrary((s) => s.collections);
  const tags = useLibrary((s) => s.tags);
  const { openEdit, openRemove } = useDocDialogs();

  const toggleTag = async (tagId: string) => {
    const next = doc.tagIds.includes(tagId) ? doc.tagIds.filter((t) => t !== tagId) : [...doc.tagIds, tagId];
    await api.setDocumentTags(doc.id, next);
    await refreshLibrary();
  };

  return (
    <>
      <C.Item onSelect={() => navigate(`/read/${doc.id}`)} disabled={doc.missing}>
        <BookOpen /> {doc.progress > 0 ? "Continue reading" : "Open"}
      </C.Item>
      <C.Item onSelect={() => toggleFavorite(doc)}>
        <Star className={doc.favorite ? "fill-current text-amber-500!" : ""} /> {doc.favorite ? "Remove from favorites" : "Add to favorites"}
      </C.Item>
      <C.Sub>
        <C.SubTrigger>
          <CircleDot /> Reading status
        </C.SubTrigger>
        <C.SubContent>
          {STATUSES.map((s) => (
            <C.Check key={s} checked={doc.status === s} onSelect={() => setStatus([doc.id], s)}>
              {STATUS_LABEL[s]}
            </C.Check>
          ))}
        </C.SubContent>
      </C.Sub>
      <C.Sub>
        <C.SubTrigger>
          <FolderPlus /> Collections
        </C.SubTrigger>
        <C.SubContent>
          {collections.length === 0 && <C.Item disabled>No collections yet</C.Item>}
          {collectionOptions(collections).map((c) => (
            <C.Check key={c.id} checked={doc.collectionIds.includes(c.id)} onSelect={(e: Event) => { e.preventDefault(); void toggleCollection(doc, c.id); }}>
              <span style={{ paddingLeft: c.depth * 12 }} className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: swatch(collections.find((x) => x.id === c.id)!.color) }} />
                {c.label}
              </span>
            </C.Check>
          ))}
        </C.SubContent>
      </C.Sub>
      <C.Sub>
        <C.SubTrigger>
          <Tag /> Tags
        </C.SubTrigger>
        <C.SubContent>
          {tags.length === 0 && <C.Item disabled>No tags yet — add them in Edit details</C.Item>}
          {tags.map((t) => (
            <C.Check key={t.id} checked={doc.tagIds.includes(t.id)} onSelect={(e: Event) => { e.preventDefault(); void toggleTag(t.id); }}>
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: swatch(t.color) }} />
                {t.name}
              </span>
            </C.Check>
          ))}
        </C.SubContent>
      </C.Sub>
      <C.Sep />
      <C.Item onSelect={() => openEdit(doc.id)}>
        <Pencil /> Edit details…
      </C.Item>
      {needsOcr(doc) && (
        <C.Item onSelect={() => useOcr.getState().openDialog(doc.id)}>
          <ScanText /> Recognise text (OCR)
        </C.Item>
      )}
      <C.Item onSelect={() => changeCover(doc)}>
        <ImagePlus /> Change cover…
      </C.Item>
      {doc.missing ? (
        <C.Item onSelect={() => relinkDocument(doc)}>
          <Link /> Locate file…
        </C.Item>
      ) : isMobile() ? null : (
        <C.Item onSelect={() => revealDocument(doc)}>
          <ExternalLink /> Show in folder
        </C.Item>
      )}
      <C.Sep />
      <C.Item danger onSelect={() => openRemove([doc.id])}>
        <Trash /> Remove…
      </C.Item>
    </>
  );
}
