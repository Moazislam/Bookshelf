// Copies runtime assets into public/ so the app works fully offline:
//  - pdf.js character maps, standard fonts and wasm decoders -> public/pdfjs
//  - tesseract.js worker, OCR engine (wasm) and English model -> public/tesseract
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfDest = join(process.cwd(), "public", "pdfjs");
mkdirSync(pdfDest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  const src = join(pdfjsRoot, dir);
  if (existsSync(src)) cpSync(src, join(pdfDest, dir), { recursive: true });
}
console.log("pdf.js assets copied to public/pdfjs");

// OCR. Only the LSTM engine builds with SIMD are shipped (~1.3 MB each once
// compressed): relaxed-SIMD for current WebView2 / Android WebView, plain SIMD
// as the fallback. The "best_int" English model is ~3 MB.
const tessRoot = dirname(require.resolve("tesseract.js/package.json"));
const coreRoot = dirname(createRequire(join(tessRoot, "package.json")).resolve("tesseract.js-core/package.json"));
const engRoot = dirname(require.resolve("@tesseract.js-data/eng/package.json"));
const ocrDest = join(process.cwd(), "public", "tesseract");
mkdirSync(join(ocrDest, "core"), { recursive: true });
mkdirSync(join(ocrDest, "lang"), { recursive: true });
copyFileSync(join(tessRoot, "dist", "worker.min.js"), join(ocrDest, "worker.min.js"));
for (const f of ["tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]) {
  copyFileSync(join(coreRoot, f), join(ocrDest, "core", f));
}
copyFileSync(join(engRoot, "4.0.0_best_int", "eng.traineddata.gz"), join(ocrDest, "lang", "eng.traineddata.gz"));
console.log("tesseract.js assets copied to public/tesseract");
