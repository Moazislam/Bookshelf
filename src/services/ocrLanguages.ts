/**
 * OCR language packs. English ships inside the app (public/tesseract/lang).
 * Other languages are downloaded once from jsDelivr (the official tesseract.js
 * model packages) and kept in IndexedDB, so OCR works offline afterwards.
 *
 * Models are stored under the same keys the tesseract.js worker reads from its
 * cache (`<CACHE_PATH>/<code>.traineddata` in idb-keyval's default store), and
 * the worker runs with cacheMethod "readOnly", so it finds them there.
 */
import { del, get, keys, set } from "idb-keyval";
import { create } from "zustand";

export const CACHE_PATH = "bookshelf-ocr";
const MODEL_VERSION = "1.0.0";
const modelUrl = (code: string) =>
  `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}@${MODEL_VERSION}/4.0.0_best_int/${code}.traineddata.gz`;
const cacheKey = (code: string) => `${CACHE_PATH}/${code}.traineddata`;

export interface OcrLanguage {
  code: string;
  name: string;
  /** Download size in bytes; 0 for the built-in language. */
  size: number;
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: "eng", name: "English", size: 0 },
  { code: "fra", name: "French", size: 707_406 },
  { code: "deu", name: "German", size: 1_333_102 },
  { code: "spa", name: "Spanish", size: 2_100_190 },
  { code: "por", name: "Portuguese", size: 1_392_239 },
  { code: "ita", name: "Italian", size: 1_660_998 },
  { code: "rus", name: "Russian", size: 2_679_598 },
  { code: "tur", name: "Turkish", size: 2_141_291 },
  { code: "chi_sim", name: "Chinese (Simplified)", size: 1_718_768 },
  { code: "ara", name: "Arabic", size: 1_661_906 },
  { code: "urd", name: "Urdu", size: 1_023_740 },
  { code: "fas", name: "Persian", size: 424_507 },
];
export const BUILT_IN = "eng";
export const languageName = (code: string) => OCR_LANGUAGES.find((l) => l.code === code)?.name ?? code;

interface LangState {
  installed: Set<string>;
  /** code -> download progress 0..1 */
  downloading: Record<string, number>;
  loaded: boolean;
  refresh: () => Promise<void>;
  download: (code: string) => Promise<void>;
  remove: (code: string) => Promise<void>;
}

export const useOcrLanguages = create<LangState>((setState, getState) => ({
  installed: new Set([BUILT_IN]),
  downloading: {},
  loaded: false,
  refresh: async () => {
    const all = await keys().catch(() => [] as IDBValidKey[]);
    const installed = new Set([BUILT_IN]);
    for (const k of all) {
      const m = typeof k === "string" && k.startsWith(`${CACHE_PATH}/`) ? /\/(.+)\.traineddata$/.exec(k) : null;
      if (m) installed.add(m[1]);
    }
    setState({ installed, loaded: true });
  },
  download: async (code) => {
    if (code === BUILT_IN || getState().downloading[code] !== undefined) return;
    const setProgress = (p: number | undefined) => {
      const downloading = { ...getState().downloading };
      if (p === undefined) delete downloading[code];
      else downloading[code] = p;
      setState({ downloading });
    };
    setProgress(0);
    try {
      const r = await fetch(modelUrl(code));
      if (!r.ok || !r.body) throw new Error(`Download failed (${r.status})`);
      const total = Number(r.headers.get("content-length")) || OCR_LANGUAGES.find((l) => l.code === code)?.size || 0;
      const reader = r.body.getReader();
      const parts: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) setProgress(Math.min(0.99, got / total));
      }
      const data = new Uint8Array(got);
      let o = 0;
      for (const p of parts) {
        data.set(p, o);
        o += p.length;
      }
      // Must be a gzip file; anything else (an error page) would break the engine.
      if (data[0] !== 0x1f || data[1] !== 0x8b) throw new Error("The downloaded file is not a language model");
      await set(cacheKey(code), data);
      await getState().refresh();
    } finally {
      setProgress(undefined);
    }
  },
  remove: async (code) => {
    if (code === BUILT_IN) return;
    await del(cacheKey(code));
    await getState().refresh();
  },
}));

export async function isInstalled(code: string) {
  return code === BUILT_IN || (await get(cacheKey(code)).catch(() => undefined)) !== undefined;
}
