import { useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition, type Contents } from "epubjs";
import { api, fileUrl } from "@/services/api";
import { useReader, HL_SWATCH, type TocItem } from "../store";
import { useSettings } from "@/stores/settings";
import { EngineError, EngineLoading, FONT_STACKS, readingPalette, useTypography } from "./common";
import type { Document, Highlight } from "@/types";

interface NavItem {
  href: string;
  label: string;
  subitems?: NavItem[];
}

/** Copy our bundled @font-face rules into the epub iframe so reading fonts work offline. */
function fontFaceCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of Array.from(rules)) {
      if (r instanceof CSSFontFaceRule && /Literata|Source Serif|Inter/.test(r.style.getPropertyValue("font-family"))) {
        const base = sheet.href ?? location.href;
        out.push(r.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, _q, u) => `url("${new URL(u, base).href}")`));
      }
    }
  }
  return out.join("\n");
}

const spineLength = (b: Book) => Math.max(1, (b.spine as unknown as { spineItems?: unknown[] }).spineItems?.length ?? 1);

function flattenToc(items: NavItem[]): TocItem[] {
  return items.map((i) => ({ label: i.label.trim(), locator: i.href, children: flattenToc(i.subitems ?? []) }));
}

export function EpubEngine({ doc, initial }: { doc: Document; initial: string | null }) {
  const set = useReader((s) => s.set);
  const highlights = useReader((s) => s.highlights);
  const flow = useSettings((s) => s.values["reading.epubFlow"]);
  const typo = useTypography();
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const rendRef = useRef<Rendition | null>(null);
  const drawn = useRef(new Map<string, string>()); // highlight id -> "color|cfi"
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [darkTick, setDarkTick] = useState(0);
  const tocRef = useRef<NavItem[]>([]);
  const lastCfi = useRef<string | null>(initial);

  useEffect(() => {
    const mo = new MutationObserver(() => setDarkTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette", "data-accent"] });
    return () => mo.disconnect();
  }, []);

  // Open book & create the rendition (recreated when flow changes).
  useEffect(() => {
    let alive = true;
    let book: Book | null = null;
    setReady(false);
    drawn.current.clear();
    (async () => {
      const res = await fetch(fileUrl.document(doc.id));
      if (res.status === 410) throw new Error("The file has been moved or deleted.");
      if (!res.ok) throw new Error(`Could not read file (${res.status})`);
      const data = await res.arrayBuffer();
      if (!alive) return;
      book = ePub(data as unknown as string);
      bookRef.current = book;
      await book.ready;
      if (!alive || !hostRef.current) return;

      const nav = (await book.loaded.navigation) as unknown as { toc: NavItem[] };
      tocRef.current = nav.toc ?? [];
      set({ toc: flattenToc(tocRef.current) });

      const rendition = book.renderTo(hostRef.current, {
        width: "100%",
        height: "100%",
        flow: flow === "scrolled" ? "scrolled-doc" : "paginated",
        spread: "auto",
        minSpreadWidth: 900,
        allowScriptedContent: false,
      });
      rendRef.current = rendition;

      const fonts = fontFaceCss();
      rendition.hooks.content.register((contents: Contents) => {
        const d = contents.document;
        const style = d.createElement("style");
        style.textContent = `${fonts}\n::selection{background:rgba(224,131,90,.35)}\nimg,svg{max-width:100%;height:auto}`;
        d.head.appendChild(style);
        // Forward keyboard shortcuts from inside the iframe to the app.
        d.addEventListener("keydown", (e: KeyboardEvent) => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true }));
        });
        d.addEventListener("mouseup", () => {
          const sel = d.getSelection();
          if (!sel || sel.isCollapsed) useReader.getState().set({ selection: null });
        });
      });

      const chapterLabel = (href: string) => {
        const base = href.split("#")[0];
        const find = (items: NavItem[]): NavItem | undefined => {
          for (const i of items) {
            if (i.href.split("#")[0].endsWith(base) || base.endsWith(i.href.split("#")[0])) return i;
            const sub = find(i.subitems ?? []);
            if (sub) return sub;
          }
        };
        return find(tocRef.current)?.label.trim();
      };

      const reportLocation = (loc: { start: { cfi: string; href: string; percentage: number; index: number; displayed: { page: number; total: number } } }) => {
        const b = bookRef.current;
        if (!b) return;
        lastCfi.current = loc.start.cfi;
        const hasLocs = b.locations.length() > 0;
        const progress = hasLocs ? b.locations.percentageFromCfi(loc.start.cfi) : loc.start.index / spineLength(b);
        const locIndex = hasLocs ? (b.locations.locationFromCfi(loc.start.cfi) as unknown as number) : null;
        const chapter = chapterLabel(loc.start.href) ?? `Section ${loc.start.index + 1}`;
        set({
          location: {
            locator: loc.start.cfi,
            progress,
            label: chapter,
            page: locIndex !== null ? locIndex + 1 : undefined,
            total: hasLocs ? b.locations.length() : undefined,
            readKey: locIndex !== null ? `l${locIndex}` : `${loc.start.href}#${loc.start.displayed.page}`,
          },
        });
      };
      rendition.on("relocated", reportLocation);

      rendition.on("selected", (cfiRange: string, contents: Contents) => {
        const range = rendition.getRange(cfiRange);
        const text = range?.toString().trim();
        if (!range || !text) return;
        const frame = (contents.window as Window).frameElement?.getBoundingClientRect();
        const r = range.getBoundingClientRect();
        const b = bookRef.current!;
        const sortKey = b.locations.length() ? b.locations.percentageFromCfi(cfiRange) : (b.spine.get(cfiRange)?.index ?? 0) / spineLength(b);
        const full = range.startContainer.textContent ?? "";
        set({
          activeHighlight: null,
          selection: {
            text,
            anchor: {
              kind: "epub",
              cfi: cfiRange,
              href: b.spine.get(cfiRange)?.href,
              quote: { exact: text, prefix: full.slice(Math.max(0, range.startOffset - 32), range.startOffset), suffix: "" },
            },
            locator: cfiRange,
            label: useReader.getState().location?.label ?? null,
            sortKey,
            rect: { x: (frame?.left ?? 0) + r.left, y: (frame?.top ?? 0) + r.top, w: r.width, h: r.height },
          },
        });
      });

      // Locations power progress %, so generate (or load cached) in the background.
      const cached = await api.cacheGet(doc.id, "epub-locations").catch(() => null);
      if (cached) book.locations.load(cached);

      await rendition.display(initial || undefined).catch(() => rendition.display());
      if (!alive) return;
      setReady(true);

      if (!cached) {
        book.locations
          .generate(1600)
          .then(() => {
            if (!alive || !bookRef.current) return;
            api.cacheSet(doc.id, "epub-locations", bookRef.current.locations.save()).catch(() => {});
            const cur = rendition.currentLocation() as unknown as Parameters<typeof reportLocation>[0];
            if (cur?.start) reportLocation(cur);
          })
          .catch(() => {});
      }
    })().catch((e) => alive && setError(e?.message ?? String(e)));

    return () => {
      alive = false;
      rendRef.current?.destroy();
      rendRef.current = null;
      book?.destroy();
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, flow]);

  // Apply typography & reading theme.
  useEffect(() => {
    const r = rendRef.current;
    if (!r || !ready) return;
    const pal = readingPalette(typo.theme);
    r.themes.override("color", pal.fg, true);
    r.themes.override("background", pal.bg, true);
    r.themes.override("line-height", String(typo.lineHeight), true);
    r.themes.override("text-align", typo.align, true);
    r.themes.fontSize(`${typo.fontSize}%`);
    if (FONT_STACKS[typo.font]) r.themes.font(FONT_STACKS[typo.font]);
    else r.themes.override("font-family", "inherit");
    if (hostRef.current?.parentElement) hostRef.current.parentElement.style.background = pal.bg;
    // Re-layout so pagination reflects the new metrics.
    const cfi = lastCfi.current;
    if (cfi) r.display(cfi).catch(() => {});
  }, [ready, typo.theme, typo.lineHeight, typo.align, typo.fontSize, typo.font, darkTick]);

  // Sync highlights with the rendition.
  useEffect(() => {
    const r = rendRef.current;
    if (!r || !ready) return;
    const want = new Map(highlights.filter((h) => h.anchor.kind === "epub").map((h) => [h.id, h]));
    // Remove highlights that were deleted or changed colour.
    for (const [id, drawnAs] of [...drawn.current]) {
      const h = want.get(id);
      if (!h || drawnAs !== `${h.color}|${(h.anchor as { cfi: string }).cfi}`) {
        try {
          r.annotations.remove(drawnAs.split("|")[1], "highlight");
        } catch {
          /* already gone */
        }
        drawn.current.delete(id);
      }
    }
    for (const h of want.values()) {
      if (drawn.current.has(h.id) || h.anchor.kind !== "epub") continue;
      const cfi = h.anchor.cfi;
      r.annotations.highlight(
        cfi,
        { id: h.id },
        (e: MouseEvent) => {
          const b = (e.target as Element).getBoundingClientRect();
          useReader.getState().set({ activeHighlight: { id: h.id, rect: { x: b.left, y: b.top, w: b.width, h: b.height } }, selection: null });
        },
        "bs-hl",
        { fill: HL_SWATCH[h.color as Highlight["color"]], "fill-opacity": "0.38", "mix-blend-mode": "multiply" },
      );
      drawn.current.set(h.id, `${h.color}|${cfi}`);
    }
  }, [highlights, ready]);

  // Imperative API.
  useEffect(() => {
    if (!ready) return;
    set({
      engine: {
        goTo: (loc) => {
          const r = rendRef.current;
          if (!r) return;
          if (/^\d+(\.\d+)?$/.test(loc) && bookRef.current?.locations.length()) {
            r.display(bookRef.current.locations.cfiFromPercentage(Number(loc))).catch(() => {});
          } else r.display(loc).catch(() => {});
        },
        goToHighlight: (h) => {
          if (h.anchor.kind === "epub") rendRef.current?.display(h.anchor.cfi).catch(() => {});
          set({ activeHighlight: null });
        },
        next: () => void rendRef.current?.next(),
        prev: () => void rendRef.current?.prev(),
        clearSelection: () => {
          const r = rendRef.current as unknown as { getContents?: () => Contents[] };
          r?.getContents?.().forEach((c) => c.window.getSelection()?.removeAllRanges());
        },
        bookmarkTarget: () => {
          const loc = useReader.getState().location;
          if (!loc) return null;
          return { locator: loc.locator, label: `${loc.label} · ${Math.round(loc.progress * 100)}%`, sortKey: loc.progress };
        },
      },
    });
  }, [ready, set]);

  if (error) return <EngineError message={error} />;
  const pad = [8, 24, 48, 80, 120][typo.margins] ?? 48;
  return (
    <div className="relative h-full transition-colors" style={{ background: readingPalette(typo.theme).bg }}>
      {!ready && <div className="absolute inset-0 z-10"><EngineLoading /></div>}
      <div className="mx-auto h-full" style={{ padding: flow === "scrolled" ? `0 ${pad}px` : `28px ${pad}px`, maxWidth: flow === "scrolled" ? 760 + pad * 2 : undefined }}>
        <div ref={hostRef} className="h-full" />
      </div>
    </div>
  );
}
