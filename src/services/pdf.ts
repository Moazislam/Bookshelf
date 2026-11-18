import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fileUrl } from "@/services/api";
import type { Document } from "@/types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PDFDocumentProxy = pdfjs.PDFDocumentProxy;
export type PDFPageProxy = pdfjs.PDFPageProxy;
export { pdfjs };

const INITIAL_CHUNK = 256 * 1024;
const SMALL_FILE = 6 * 1024 * 1024;

/**
 * Streams the PDF from the bookfile:// protocol using HTTP range requests, so
 * opening a 500 MB PDF only reads the bytes needed for the visible pages.
 */
class BookfileRangeTransport extends pdfjs.PDFDataRangeTransport {
  constructor(private url: string, length: number, initial: Uint8Array) {
    super(length, initial);
  }
  requestDataRange(begin: number, end: number) {
    fetch(this.url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`Range request failed (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => this.onDataRange(begin, new Uint8Array(buf)))
      .catch((e) => console.error("PDF range request failed", e));
  }
}

async function fetchRange(url: string, start: number, end: number) {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (r.status === 410) throw new Error("The file has been moved or deleted.");
  if (!r.ok) throw new Error(`Could not read file (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

const common = {
  isEvalSupported: false,
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  enableXfa: false,
};

export async function openPdf(doc: Pick<Document, "id" | "fileSize">): Promise<PDFDocumentProxy> {
  const url = fileUrl.document(doc.id);
  if (doc.fileSize <= SMALL_FILE) {
    const r = await fetch(url);
    if (r.status === 410) throw new Error("The file has been moved or deleted.");
    if (!r.ok) throw new Error(`Could not read file (${r.status})`);
    const data = new Uint8Array(await r.arrayBuffer());
    return pdfjs.getDocument({ data, ...common }).promise;
  }
  const initial = await fetchRange(url, 0, Math.min(INITIAL_CHUNK, doc.fileSize) - 1);
  const transport = new BookfileRangeTransport(url, doc.fileSize, initial);
  return pdfjs.getDocument({
    range: transport,
    rangeChunkSize: 512 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    ...common,
  }).promise;
}

/** Text of one page, with items joined the same way the text layer lays them out. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let out = "";
  for (const item of content.items) {
    if ("str" in item) {
      out += item.str;
      if (item.hasEOL) out += "\n";
    }
  }
  return out;
}

export function parsePdfDate(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const m = /D:(\d{4})(\d{2})?(\d{2})?/.exec(s);
  if (!m) return undefined;
  return [m[1], m[2], m[3]].filter(Boolean).join("-");
}
