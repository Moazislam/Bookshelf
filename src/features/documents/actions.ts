import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, errorMessage, isMobile } from "@/services/api";
import { refreshLibrary, useLibrary } from "@/stores/library";
import { enqueuePdfProcessing } from "@/services/pdfProcessing";
import type { Document, DocumentPatch, ReadingStatus } from "@/types";
import { STATUS_LABEL } from "@/utils";

async function guard<T>(p: Promise<T>, failMsg: string): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    toast.error(failMsg, { description: errorMessage(e) });
    return undefined;
  }
}

export async function updateDocuments(ids: string[], patch: DocumentPatch) {
  const docs = await guard(api.updateDocuments(ids, patch), "Could not update document");
  if (docs) useLibrary.getState().upsertDocuments(docs);
  return docs;
}

export const toggleFavorite = (doc: Document) => updateDocuments([doc.id], { favorite: !doc.favorite });

export async function setStatus(ids: string[], status: ReadingStatus) {
  const r = await updateDocuments(ids, { status });
  if (r && ids.length > 1) toast.success(`Marked ${ids.length} documents as ${STATUS_LABEL[status].toLowerCase()}`);
}

export async function setFavorite(ids: string[], favorite: boolean) {
  await updateDocuments(ids, { favorite });
}

export async function addToCollection(ids: string[], collectionId: string, name: string) {
  if ((await guard(api.addDocumentsToCollection(ids, collectionId), "Could not add to collection")) !== undefined) {
    await refreshLibrary();
    toast.success(ids.length === 1 ? `Added to ${name}` : `Added ${ids.length} documents to ${name}`);
  }
}

export async function removeFromCollection(ids: string[], collectionId: string) {
  if ((await guard(api.removeDocumentsFromCollection(ids, collectionId), "Could not remove from collection")) !== undefined) {
    await refreshLibrary();
  }
}

export async function toggleCollection(doc: Document, collectionId: string) {
  const next = doc.collectionIds.includes(collectionId) ? doc.collectionIds.filter((c) => c !== collectionId) : [...doc.collectionIds, collectionId];
  if ((await guard(api.setDocumentCollections(doc.id, next), "Could not update collections")) !== undefined) await refreshLibrary();
}

export async function addTag(ids: string[], tagId: string) {
  if ((await guard(api.addTagToDocuments(ids, tagId), "Could not add tag")) !== undefined) await refreshLibrary();
}

export async function removeDocuments(ids: string[], deleteFiles: boolean) {
  // On phones BookShelf stores its own copy of each book; removing it frees that space.
  // The file the user originally picked (e.g. in Downloads) is never touched.
  const mobile = isMobile();
  const r = await guard(api.removeDocuments(ids, mobile || deleteFiles), "Could not remove documents");
  if (!r) return;
  useLibrary.getState().dropDocuments(ids);
  await refreshLibrary();
  if (mobile) {
    if (r.failed.length) toast.error("Some stored copies could not be deleted", { description: r.failed.slice(0, 3).join("\n") });
    toast.success(`Removed ${r.removed} document${r.removed === 1 ? "" : "s"} from your library`, {
      description: "The original files on your device were not touched.",
    });
    return;
  }
  if (r.failed.length) {
    toast.error("Some files could not be moved to the Recycle Bin", { description: r.failed.slice(0, 3).join("\n") });
  }
  toast.success(
    deleteFiles
      ? `Removed ${r.removed} document${r.removed === 1 ? "" : "s"} and moved ${r.trashed} file${r.trashed === 1 ? "" : "s"} to the Recycle Bin`
      : `Removed ${r.removed} document${r.removed === 1 ? "" : "s"} from your library`,
    { description: deleteFiles ? undefined : "The original files were not touched." },
  );
}

export async function changeCover(doc: Document) {
  const path = await open({ title: "Choose a cover image", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }] });
  if (!path || Array.isArray(path)) return;
  const d = await guard(api.setCoverFromFile(doc.id, path), "Could not set cover");
  if (d) {
    useLibrary.getState().upsertDocuments([d]);
    toast.success("Cover updated");
  }
}

export async function revealDocument(doc: Document) {
  await guard(api.revealDocument(doc.id), "Could not open the folder");
}

export async function relinkDocument(doc: Document) {
  const path = await open({ title: `Locate “${doc.fileName}”`, filters: [{ name: doc.format.toUpperCase(), extensions: doc.format === "md" ? ["md", "markdown"] : [doc.format] }] });
  if (!path || Array.isArray(path)) return;
  let r = await guard(api.relinkDocument(doc.id, path, false), "Could not relink");
  if (!r) return;
  if (!r.hashMatches && !r.document) {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm("This file's contents differ from the original. Highlights may no longer line up exactly. Link it anyway?", {
      title: "Different file",
      kind: "warning",
      okLabel: "Link anyway",
    });
    if (!ok) return;
    r = await guard(api.relinkDocument(doc.id, path, true), "Could not relink");
  }
  if (r?.document) {
    useLibrary.getState().upsertDocuments([r.document]);
    if (r.document.format === "pdf" && (!r.document.metadataReady || !r.document.textIndexed)) enqueuePdfProcessing([r.document.id]);
    toast.success("File located", { description: r.document.path });
  }
}
