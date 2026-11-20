/**
 * OCR for scanned books: PDFs whose pages are only images, and comics (CBZ).
 * Pages are rendered (PDF) or fetched (CBZ) one at a time and recognised with
 * tesseract.js in a web worker, fully offline: the worker, the wasm engine and
 * the English model are bundled under /tesseract (see scripts/copy-pdfjs-assets.mjs);
 * other languages are downloaded once (see ocrLanguages.ts).
 * The recognised text goes into the normal full-text index, one chunk per page,
 * so library search and "find in document" work like for any other PDF.
 *
 * Progress is saved after every batch of pages, so a job interrupted by
 * quitting the app (or Android killing it in the background) resumes where it
 * stopped on the next launch.
 */
import { toast } from "sonner";
import { create } from "zustand";
import type { Worker as OcrWorker } from "tesseract.js";
import { api, errorMessage, fileUrl } from "@/services/api";
import { BUILT_IN, CACHE_PATH, isInstalled, languageName } from "@/services/ocrLanguages";
import { openPdf } from "@/services/pdf";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import type { Document, TextChunk } from "@/types";

/** True when a book was indexed but has no text at all, so OCR can help. */
export const needsOcr = (doc: Document) =>
  (doc.format === "pdf" || doc.format === "cbz") && doc.textIndexed && doc.textSource === "none" && !doc.missing;

const PROGRESS_KEY = "ocr.progress";
const BATCH = 5;

export interface OcrJob {
  id: string;
  title: string;
  langs: string[];
  status: "queued" | "running";
  /** Pages finished so far (including ones done before a resume). */
  done: number;
  total: number;
  /** Pages that produced text. */
  found: number;
  /** For the time estimate: when this run started and at which page. */
  startedAt: number;
  startedPage: number;
}

interface SavedProgress {
  next: number;
  found: number;
  langs: string[];
}

interface OcrState {
  jobs: Record<string, OcrJob>;
  /** Book whose OCR screen is open. */
  dialogId: string | null;
  openDialog: (id: string) => void;
  closeDialog: () => void;
}

export const useOcr = create<OcrState>((set) => ({
  jobs: {},
  dialogId: null,
  openDialog: (id) => set({ dialogId: id }),
  closeDialog: () => set({ dialogId: null }),
}));

const patchJob = (id: string, patch: Partial<OcrJob> | null) =>
  useOcr.setState((s) => {
    const jobs = { ...s.jobs };
    if (patch === null) delete jobs[id];
    else jobs[id] = { ...jobs[id], ...patch };
    return { jobs };
  });

export const isOcrRunning = () => Object.keys(useOcr.getState().jobs).length > 0;

const queue: string[] = [];
const cancelled = new Set<string>();
let running = false;
let worker: OcrWorker | null = null;
let workerLangs = "";

const taskId = (id: string) => `ocr-${id}`;

export const defaultOcrLanguages = () => {
  const v = useSettings.getState().values["ocr.languages"];
  return Array.isArray(v) && v.length ? v : [BUILT_IN];
};

export async function savedOcrProgress(id: string): Promise<SavedProgress | null> {
  try {
    const raw = await api.cacheGet(id, PROGRESS_KEY);
    const p = raw ? (JSON.parse(raw) as SavedProgress) : null;
    return p && p.next > 1 ? p : null;
  } catch {
    return null;
  }
}
const saveProgress = (id: string, p: SavedProgress | null) => api.cacheSet(id, PROGRESS_KEY, p ? JSON.stringify(p) : "").catch(() => {});

/**
 * Queue a book for OCR. `resume` continues from saved progress (same languages);
 * otherwise the book's text index is rebuilt from page 1.
 */
export async function startOcr(doc: Document, langs: string[], resume = false) {
  if (useOcr.getState().jobs[doc.id]) return;
  const saved = resume ? await savedOcrProgress(doc.id) : null;
  const use = saved?.langs.length ? saved.langs : langs.length ? langs : [BUILT_IN];
  if (!saved) await saveProgress(doc.id, null);
  cancelled.delete(doc.id);
  patchJob(doc.id, {
    id: doc.id,
    title: doc.title,
    langs: use,
    status: "queued",
    done: saved ? saved.next - 1 : 0,
    total: doc.pageCount ?? 0,
    found: saved?.found ?? 0,
    startedAt: Date.now(),
    startedPage: saved ? saved.next - 1 : 0,
  });
  useUI.getState().upsertTask({ id: taskId(doc.id), label: "Recognising text", detail: `${doc.title} — waiting`, progress: 0, status: "running" });
  queue.push(doc.id);
  void run();
}

/** Stop a job. Text recognised so far stays searchable; the next run starts over. */
export function cancelOcr(id: string) {
  cancelled.add(id);
  const i = queue.indexOf(id);
  if (i >= 0) {
    queue.splice(i, 1);
    finish(id);
    void saveProgress(id, null);
  }
}

function finish(id: string) {
  patchJob(id, null);
  useUI.getState().removeTask(taskId(id));
}

/** Offer OCR right after an import finds a PDF with no text layer. */
export function offerOcr(doc: Document) {
  toast(`“${doc.title}” has no searchable text`, {
    description: "It looks like a scanned book. Recognise the text so you can search it?",
    duration: 12000,
    action: { label: "Recognise text", onClick: () => useOcr.getState().openDialog(doc.id) },
  });
}

/** Called on startup: continue jobs that a previous shutdown interrupted. */
export async function resumeInterruptedOcr(docs: Document[]) {
  for (const doc of docs.filter(needsOcr)) {
    const saved = await savedOcrProgress(doc.id);
    if (!saved) continue;
    await startOcr(doc, saved.langs, true);
    toast(`Continuing text recognition for “${doc.title}”`, {
      description: `Picking up at page ${saved.next}.`,
      action: { label: "Show", onClick: () => useOcr.getState().openDialog(doc.id) },
    });
  }
}

async function getWorker(langs: string[]) {
  const key = langs.join("+");
  if (worker && workerLangs === key) return worker;
  await worker?.terminate().catch(() => {});
  worker = null;
  for (const l of langs) {
    if (!(await isInstalled(l))) throw new Error(`The ${languageName(l)} language pack is not downloaded. Get it in Settings → Library.`);
  }
  // tesseract.js is CommonJS; depending on the bundler the API sits on the module or on `default`.
  const mod = await import("tesseract.js");
  const { createWorker, OEM } = "createWorker" in mod ? mod : (mod as unknown as { default: typeof mod }).default;
  const w = await createWorker(langs, OEM.LSTM_ONLY, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    workerBlobURL: false,
    // English is read from the app bundle, downloaded languages from IndexedDB
    // (ocrLanguages.ts). Nothing is fetched from the network here.
    cachePath: CACHE_PATH,
    cacheMethod: "readOnly",
  });
  // Chinese is written without spaces; keep tesseract from inserting them between characters.
  if (langs.includes("chi_sim")) await w.setParameters({ preserve_interword_spaces: "1" });
  worker = w;
  workerLangs = key;
  return w;
}

// Keep the screen (and so the app) awake while OCR runs; Android pauses apps in
// the background. Not every WebView supports this, so failures are ignored.
let wakeLock: { release: () => Promise<void> } | null = null;
async function holdWakeLock(on: boolean) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await (navigator as Navigator & { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}
// A wake lock is dropped whenever the page is hidden; take it again on return.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && running) {
      wakeLock = null;
      void holdWakeLock(true);
    }
  });
}

async function run() {
  if (running) return;
  running = true;
  void holdWakeLock(true);
  const ui = useUI.getState();
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const doc = await api.getDocument(id).catch(() => null);
      const job = useOcr.getState().jobs[id];
      if (!doc || !job) {
        finish(id);
        continue;
      }
      patchJob(id, { status: "running", startedAt: Date.now() });
      try {
        const found = await recognise(doc, job);
        if (found === null) {
          await saveProgress(id, null);
          finish(id);
          toast(`Stopped recognising “${doc.title}”`);
          continue;
        }
        await saveProgress(id, null);
        const fresh = await api.getDocument(id);
        useLibrary.getState().upsertDocuments([fresh]);
        patchJob(id, null);
        ui.upsertTask({ id: taskId(id), label: found ? "Text recognised" : "No text found", detail: doc.title, progress: 1, status: "done" });
        if (found) toast.success(`“${doc.title}” is now searchable`, { description: `Text found on ${found} page${found === 1 ? "" : "s"}.` });
        else toast.warning(`No text found in “${doc.title}”`, { description: "Check that the right languages were picked." });
        setTimeout(() => useUI.getState().removeTask(taskId(id)), 4000);
      } catch (e) {
        console.warn("OCR failed", doc.fileName, e);
        patchJob(id, null);
        ui.upsertTask({ id: taskId(id), label: `Could not recognise text in ${doc.title}`, detail: errorMessage(e), progress: null, status: "error" });
      }
    }
  } finally {
    running = false;
    void holdWakeLock(false);
    // Free the engine's memory (tens of MB) once nothing is waiting.
    const w = worker;
    worker = null;
    workerLangs = "";
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

/**
 * Recognises the remaining pages and indexes the text. Returns how many pages
 * had text, or null when the job was cancelled.
 */
async function recognise(doc: Document, job: OcrJob): Promise<number | null> {
  const pages = await openPages(doc);
  const ui = useUI.getState();
  try {
    const w = await getWorker(job.langs);
    const start = job.done + 1;
    patchJob(doc.id, { total: pages.total, startedPage: job.done });
    let batch: TextChunk[] = [];
    let first = start === 1;
    let found = job.found;
    for (let n = start; n <= pages.total; n++) {
      if (cancelled.has(doc.id)) return null;
      ui.upsertTask({ id: taskId(doc.id), label: "Recognising text", detail: `${doc.title} — page ${n} of ${pages.total}`, progress: (n - 1) / pages.total, status: "running" });
      const image = await pages.image(n);
      const { data } = await w.recognize(image);
      if (image instanceof HTMLCanvasElement) image.width = image.height = 0; // release the bitmap now
      const text = cleanText(data.text);
      if (text) {
        batch.push({ locator: String(n), label: `Page ${n}`, text });
        found++;
      }
      const last = n === pages.total;
      if (last || n % BATCH === 0) {
        await api.indexDocumentText(doc.id, batch, first, last, true);
        first = false;
        batch = [];
        if (!last) await saveProgress(doc.id, { next: n + 1, found, langs: job.langs });
      }
      patchJob(doc.id, { done: n, found });
    }
    if (pages.total === 0) await api.indexDocumentText(doc.id, [], true, true, true);
    return found;
  } finally {
    await pages.close();
  }
}

/**
 * Tidies tesseract output: trims lines and drops ones that are only border noise
 * (no letter or digit at all). Lines that are just a number, such as page
 * numbers, are kept so they can be searched.
 */
export function cleanText(text: string) {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => !l || /[\p{L}\p{N}]/u.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
