import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, errorMessage } from "@/services/api";
import { enqueuePdfProcessing } from "@/services/pdfProcessing";
import { refreshLibrary } from "@/stores/library";
import { useUI } from "@/stores/ui";
import type { ImportProgress, ImportReport } from "@/types";

export const SUPPORTED_EXTENSIONS = ["pdf", "epub", "txt", "md", "markdown", "cbz"];

let listening = false;
const jobLabels = new Map<string, number>();

/** Subscribe once to backend import events. */
export async function initImportListeners() {
  if (listening) return;
  listening = true;
  await listen<ImportProgress>("import-progress", ({ payload }) => {
    useUI.getState().upsertTask({
      id: payload.jobId,
      label: `Importing ${payload.index + 1} of ${payload.total}`,
      detail: payload.fileName,
      progress: payload.total ? payload.index / payload.total : null,
      status: "running",
    });
  });
  await listen<ImportReport>("import-complete", async ({ payload }) => {
    const ui = useUI.getState();
    jobLabels.delete(payload.jobId);
    await refreshLibrary();
    if (payload.pdfPending.length) enqueuePdfProcessing(payload.pdfPending);

    const added = payload.imported.length;
    const parts = [] as string[];
    if (added) parts.push(`${added} added`);
    if (payload.relinked.length) parts.push(`${payload.relinked.length} relinked`);
    if (payload.duplicates.length) parts.push(`${payload.duplicates.length} already in library`);
    if (payload.errors.length) parts.push(`${payload.errors.length} failed`);
    if (payload.warnings.length) parts.push(`${payload.warnings.length} warning${payload.warnings.length > 1 ? "s" : ""}`);
    ui.upsertTask({ id: payload.jobId, label: "Import finished", detail: parts.join(" · "), progress: 1, status: payload.errors.length ? "error" : "done" });
    setTimeout(() => useUI.getState().removeTask(payload.jobId), 4000);

    if (payload.errors.length) {
      toast.error(`${payload.errors.length} file${payload.errors.length > 1 ? "s" : ""} could not be imported`, {
        description: payload.errors.slice(0, 4).map((e) => `${e.fileName}: ${e.message}`).join("\n"),
        duration: 10000,
      });
    }
    if (payload.warnings.length) {
      toast.warning(
        `${payload.warnings.length} file${payload.warnings.length > 1 ? "s" : ""} imported with warnings`,
        { description: payload.warnings.slice(0, 4).map((w) => `${w.fileName}: ${w.message}`).join("\n"), duration: 10000 },
      );
    }
    if (added || payload.relinked.length) {
      toast.success(added === 1 ? "Document added to your library" : `${added + payload.relinked.length} documents imported`, {
        description: parts.join(" · "),
      });
    } else if (payload.duplicates.length && !payload.errors.length) {
      toast.message("Nothing new to import", { description: "Those files are already in your library." });
    }
  });
}

export async function importPaths(paths: string[], collectionId?: string | null) {
  if (!paths.length) return;
  try {
    const job = await api.importPaths(paths, collectionId);
    if (job.total === 0) {
      toast.message("No supported files found", { description: "BookShelf can import PDF, EPUB, CBZ, TXT and Markdown files." });
      return;
    }
    jobLabels.set(job.jobId, job.total);
    useUI.getState().upsertTask({ id: job.jobId, label: `Importing ${job.total} file${job.total > 1 ? "s" : ""}`, progress: 0, status: "running" });
  } catch (e) {
    toast.error("Import failed", { description: errorMessage(e) });
  }
}

export async function pickAndImportFiles(collectionId?: string | null) {
  const selected = await open({
    multiple: true,
    directory: false,
    title: "Import documents",
    filters: [
      { name: "Documents", extensions: SUPPORTED_EXTENSIONS },
      { name: "PDF", extensions: ["pdf"] },
      { name: "EPUB", extensions: ["epub"] },
      { name: "Comics", extensions: ["cbz"] },
      { name: "Text", extensions: ["txt", "md", "markdown"] },
    ],
  });
  if (!selected) return;
  await importPaths(Array.isArray(selected) ? selected : [selected], collectionId);
}

export async function pickAndImportFolder(collectionId?: string | null) {
  const selected = await open({ directory: true, multiple: true, title: "Import a folder" });
  if (!selected) return;
  await importPaths(Array.isArray(selected) ? selected : [selected], collectionId);
}
