/**
 * OCR for scanned books: PDFs whose pages are only images, and comics (CBZ).
 * Pages are rendered (PDF) or fetched (CBZ) one at a time and recognised with
 * tesseract.js in a web worker, fully offline: the worker, the wasm engine and
 * the English model are bundled under /tesseract (see scripts/copy-pdfjs-assets.mjs).
 * The recognised text goes into the normal full-text index, one chunk per page,
 * so library search and "find in document" work like for any other PDF.
 */
import { toast } from "sonner";
import type { Worker as OcrWorker } from "tesseract.js";
import { api, errorMessage, fileUrl } from "@/services/api";
import { openPdf } from "@/services/pdf";
import { useLibrary } from "@/stores/library";
import { useUI } from "@/stores/ui";
import type { Document, TextChunk } from "@/types";

/** True when a book was indexed but has no text at all, so OCR can help. */
export const needsOcr = (doc: Document) =>
  (doc.format === "pdf" || doc.format === "cbz") && doc.textIndexed && doc.textSource === "none" && !doc.missing;

const queue: string[] = [];
const active = new Set<string>();
let running = false;
let worker: OcrWorker | null = null;

const taskId = (id: string) => `ocr-${id}`;

export const isOcrQueued = (id: string) => active.has(id);

export function enqueueOcr(id: string) {
  if (active.has(id)) return;
  active.add(id);
  queue.push(id);
  const doc = useLibrary.getState().byId[id];
  useUI.getState().upsertTask({ id: taskId(id), label: "Recognising text", detail: doc ? `${doc.title} — waiting` : "Waiting", progress: 0, status: "running" });
  void run();
}

/** Offer OCR right after an import finds a PDF with no text layer. */
export function offerOcr(doc: Document) {
  toast(`“${doc.title}” has no searchable text`, {
    description: "It looks like a scanned book. Recognise the text so you can search it?",
    duration: 12000,
    action: { label: "Recognise text", onClick: () => enqueueOcr(doc.id) },
  });
}

async function getWorker() {
  if (worker) return worker;
  // tesseract.js is CommonJS; depending on the bundler the API sits on the module or on `default`.
  const mod = await import("tesseract.js");
  const { createWorker, OEM } = "createWorker" in mod ? mod : (mod as unknown as { default: typeof mod }).default;
  worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    workerBlobURL: false,
    // The model is bundled with the app; copying it into IndexedDB would only waste space.
    cacheMethod: "none",
  });
  return worker;
}

async function run() {
  if (running) return;
  running = true;
  const ui = useUI.getState();
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const doc = await api.getDocument(id).catch(() => null);
      if (!doc) {
        ui.removeTask(taskId(id));
        active.delete(id);
        continue;
      }
      const progress = (p: number, page?: string) =>
        ui.upsertTask({ id: taskId(id), label: "Recognising text", detail: page ? `${doc.title} — ${page}` : doc.title, progress: p, status: "running" });
      try {
        progress(0, "starting");
        const found = await recognise(doc, progress);
        const fresh = await api.getDocument(id);
        useLibrary.getState().upsertDocuments([fresh]);
        ui.upsertTask({ id: taskId(id), label: found ? "Text recognised" : "No text found", detail: doc.title, progress: 1, status: "done" });
        if (found) toast.success(`“${doc.title}” is now searchable`, { description: `Text found on ${found} page${found === 1 ? "" : "s"}.` });
        setTimeout(() => useUI.getState().removeTask(taskId(id)), 4000);
      } catch (e) {
        console.warn("OCR failed", doc.fileName, e);
        ui.upsertTask({ id: taskId(id), label: `Could not recognise text in ${doc.title}`, detail: errorMessage(e), progress: null, status: "error" });
      }
      active.delete(id);
    }
  } finally {
    running = false;
    // Free the engine's memory (tens of MB) once nothing is waiting.
    const w = worker;
    worker = null;
    await w?.terminate().catch(() => {});
  }
}

type PageSource = { total: number; image: (n: number) => Promise<HTMLCanvasElement | Blob>; close: () => Promise<void> };

async function openPages(doc: Document): Promise<PageSource> {
  if (doc.format === "cbz") {
    return {
      total: doc.pageCount ?? 0,
      image: async (n) => {
        const r = await fetch(fileUrl.cbzPage(doc.id, n - 1));
        if (!r.ok) throw new Error(`Could not read page ${n} (${r.status})`);
        return r.blob();
      },
      close: async () => {},
    };
  }
  const pdf = await openPdf(doc);
  return {
    total: pdf.numPages,
    image: async (n) => {
      const page = await pdf.getPage(n);
      try {
        // ~2000 px wide is plenty for book text and keeps memory low on phones.
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, Math.max(1.5, 2000 / base.width)) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas is not available");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // "print" renders without requestAnimationFrame, which never fires while the
        // window is minimised or the Android app is in the background.
        await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;
        return canvas;
      } finally {
        page.cleanup();
      }
    },
    close: () => pdf.loadingTask.destroy(),
  };
}

/** Recognises every page and indexes the text. Returns how many pages had text. */
async function recognise(doc: Document, onProgress: (p: number, page?: string) => void): Promise<number> {
  const pages = await openPages(doc);
  try {
    const w = await getWorker();
    let batch: TextChunk[] = [];
    let first = true;
    let found = 0;
    for (let n = 1; n <= pages.total; n++) {
      onProgress((n - 1) / pages.total, `page ${n} of ${pages.total}`);
      const image = await pages.image(n);
      const { data } = await w.recognize(image);
      if (image instanceof HTMLCanvasElement) image.width = image.height = 0; // release the bitmap now
      const text = cleanText(data.text);
      if (text) {
        batch.push({ locator: String(n), label: `Page ${n}`, text });
        found++;
      }
      if (batch.length >= 5 || n === pages.total) {
        await api.indexDocumentText(doc.id, batch, first, n === pages.total, true);
        first = false;
        batch = [];
      }
    }
    if (pages.total === 0) await api.indexDocumentText(doc.id, [], true, true, true);
    return found;
  } finally {
    await pages.close();
  }
}

/** Tesseract output: drop stray whitespace and lines that are pure noise from page borders. */
function cleanText(text: string) {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => !l || /[\p{L}\p{N}]{2,}/u.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
