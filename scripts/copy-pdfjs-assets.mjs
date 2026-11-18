// Copies pdf.js runtime assets (character maps, standard fonts, wasm decoders)
// into public/pdfjs so the app renders every PDF fully offline.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
const dest = join(process.cwd(), "public", "pdfjs");
mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  const src = join(root, dir);
  if (existsSync(src)) cpSync(src, join(dest, dir), { recursive: true });
}
console.log("pdf.js assets copied to public/pdfjs");
