/**
 * Background queue that extracts PDF metadata, a cover thumbnail and per-page
 * text (for full-text search) using pdf.js. Runs sequentially and yields to the
 * UI between pages so imports never block reading or browsing.
 */
import { api, errorMessage } from "@/services/api";
import { offerOcr, needsOcr } from "@/services/ocr";
import { openPdf, pageText, parsePdfDate } from "@/services/pdf";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import type { Document, TextChunk } from "@/types";

const queue: string[] = [];
const queued = new Set<string>();
let running = false;
const TASK_ID = "pdf-processing";

const idle = () => new Promise<void>((r) => ("requestIdleCallback" in window ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 16)));

export function enqueuePdfProcessing(ids: string[]) {
  for (const id of ids) {
    if (!queued.has(id)) {
      queued.add(id);
      queue.push(id);
    }
  }
  void run();
}

/** Called on startup to resume work interrupted by a previous shutdown. */
export function resumePendingPdfWork(docs: Document[]) {
  const extract = useSettings.getState().values["library.extractText"];
  enqueuePdfProcessing(docs.filter((d) => d.format === "pdf" && !d.missing && (!d.metadataReady || (extract && !d.textIndexed))).map((d) => d.id));
}

async function run() {
  if (running) return;
  running = true;
  const ui = useUI.getState();
  let done = 0;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const total = done + queue.length + 1;
      const doc = useLibrary.getState().byId[id] ?? (await api.getDocument(id).catch(() => null));
      if (!doc) {
        queued.delete(id);
        continue;
      }
      ui.upsertTask({ id: TASK_ID, label: "Processing PDFs", detail: doc.title, progress: done / total, status: "running" });
      try {
        await processOne(doc, (p) =>
          ui.upsertTask({ id: TASK_ID, label: "Processing PDFs", detail: doc.title, progress: (done + p) / total, status: "running" }),
        );
      } catch (e) {
        console.warn("PDF processing failed", doc.fileName, e);
        ui.upsertTask({ id: `pdf-error-${id}`, label: `Could not process ${doc.fileName}`, detail: errorMessage(e), progress: null, status: "error" });
      }
      queued.delete(id);
      done++;
    }
  } finally {
    running = false;
    ui.upsertTask({ id: TASK_ID, label: "PDFs processed", progress: 1, status: "done" });
    setTimeout(() => useUI.getState().removeTask(TASK_ID), 2500);
  }
}

async function processOne(doc: Document, onProgress: (p: number) => void) {
  const pdf = await openPdf(doc);
  try {
    if (!doc.metadataReady) {
      const meta = await pdf.getMetadata().catch(() => null);
      const info = (meta?.info ?? {}) as Record<string, unknown>;
      const cover = await renderCover(pdf).catch(() => null);
      const updated = await api.finalizePdfImport(
        doc.id,
        {
          title: typeof info.Title === "string" ? info.Title : undefined,
          author: typeof info.Author === "string" ? info.Author : undefined,
          description: typeof info.Subject === "string" ? info.Subject : undefined,
          published: parsePdfDate(info.CreationDate),
          pageCount: pdf.numPages,
        },
        cover,
      );
      useLibrary.getState().upsertDocuments([updated]);
    }
    if (!useSettings.getState().values["library.extractText"] || doc.textIndexed) return;

    let batch: TextChunk[] = [];
    let first = true;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const text = await pageText(page);
      page.cleanup();
      if (text.trim()) batch.push({ locator: String(n), label: `Page ${n}`, text });
      if (batch.length >= 25 || n === pdf.numPages) {
        await api.indexDocumentText(doc.id, batch, first, n === pdf.numPages);
        first = false;
        batch = [];
        onProgress(n / pdf.numPages);
      }
      if (n % 4 === 0) await idle();
    }
    if (pdf.numPages === 0) await api.indexDocumentText(doc.id, [], true, true);
    const fresh = await api.getDocument(doc.id);
    useLibrary.getState().upsertDocuments([fresh]);
    if (needsOcr(fresh)) offerOcr(fresh);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function renderCover(pdf: Awaited<ReturnType<typeof openPdf>>): Promise<number[] | null> {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = 480 / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  page.cleanup();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) return null;
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
