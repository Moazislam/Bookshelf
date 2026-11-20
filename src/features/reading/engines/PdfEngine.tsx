import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { openPdf, pdfjs, type PDFDocumentProxy } from "@/services/pdf";
import { useReader, quoteFrom, type TocItem } from "../store";
import { useSettings } from "@/stores/settings";
import { cn } from "@/utils";
import type { Document, Highlight } from "@/types";
import { EngineError, EngineLoading } from "./common";

type Rect = { x: number; y: number; w: number; h: number; p?: number };
const GAP = 16;
const PAD = 24;

export type ZoomMode = "fit-width" | "fit-page" | number;

function parseLocator(loc: string): { page: number; frac: number } {
  const [p, f] = loc.split("@");
  return { page: Math.max(1, parseInt(p, 10) || 1), frac: Math.min(1, Math.max(0, parseFloat(f) || 0)) };
}

function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => (a.p ?? 0) - (b.p ?? 0) || a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.p === r.p && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 && r.x <= last.x + last.w + 0.012) {
      const x1 = Math.min(last.x, r.x), y1 = Math.min(last.y, r.y);
      const x2 = Math.max(last.x + last.w, r.x + r.w), y2 = Math.max(last.y + last.h, r.y + r.h);
      Object.assign(last, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    } else out.push({ ...r });
  }
  return out;
}

// ---------------------------------------------------------------------------
// A single page: canvas + selectable text layer + highlight overlay
// ---------------------------------------------------------------------------

interface PageProps {
  pdf: PDFDocumentProxy;
  page: number;
  scale: number;
  baseW: number;
  baseH: number;
  highlights: Highlight[];
  activeId: string | null;
  invert: boolean;
  find: string;
  onSize: (page: number, w: number, h: number) => void;
}

const PdfPage = memo(function PdfPage({ pdf, page, scale, baseW, baseH, highlights, activeId, invert, find, onSize }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<pdfjs.PDFPageProxy["render"]> | null = null;
    let textLayer: pdfjs.TextLayer | null = null;
    setRendered(false);
    (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const vp1 = p.getViewport({ scale: 1 });
      if (Math.abs(vp1.width - baseW) > 0.5 || Math.abs(vp1.height - baseH) > 0.5) onSize(page, vp1.width, vp1.height);
      const viewport = p.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Render into an offscreen canvas then swap, to avoid a blank flash while zooming.
      const off = document.createElement("canvas");
      off.width = Math.floor(viewport.width * dpr);
      off.height = Math.floor(viewport.height * dpr);
      const ctx = off.getContext("2d", { alpha: false });
      if (!ctx) return;
      renderTask = p.render({ canvas: off, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try {
        await renderTask.promise;
      } catch {
        return; // cancelled
      }
      if (cancelled) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext("2d")?.drawImage(off, 0, 0);
      const container = textRef.current;
      if (container) {
        container.replaceChildren();
        textLayer = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container, viewport });
        await textLayer.render().catch(() => {});
        if (!cancelled) {
          const end = document.createElement("div");
          end.className = "endOfContent";
          container.append(end);
        }
      }
      if (!cancelled) setRendered(true);
    })().catch((e) => console.warn("Page render failed", page, e));
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, page, scale, baseW, baseH, onSize]);

  // Mark text-layer spans that contain the find query.
  useEffect(() => {
    const el = textRef.current;
    if (!el || !rendered) return;
    const q = find.trim().toLowerCase();
    el.querySelectorAll("span.pdf-find").forEach((s) => s.classList.remove("pdf-find"));
    if (q.length < 2) return;
    const words = q.split(/\s+/);
    el.querySelectorAll("span").forEach((s) => {
      const t = s.textContent?.toLowerCase() ?? "";
      if (words.some((w) => w.length > 1 && t.includes(w))) s.classList.add("pdf-find");
    });
  }, [find, rendered]);

  const rects = useMemo(() => {
    const out: { id: string; color: string; r: Rect }[] = [];
    for (const h of highlights) {
      if (h.anchor.kind !== "pdf") continue;
      for (const r of h.anchor.rects as Rect[]) if ((r.p ?? h.anchor.page) === page) out.push({ id: h.id, color: h.color, r });
    }
    return out;
  }, [highlights, page]);

  const w = baseW * scale, h = baseH * scale;
  return (
    <div
      data-page={page}
      className={cn("pdf-page mx-auto", invert && "pdf-dim")}
      style={{ width: w, height: h, ["--total-scale-factor" as string]: scale }}
    >
      <canvas ref={canvasRef} aria-label={`Page ${page}`} />
      {!rendered && <div className="absolute inset-0 grid place-items-center text-[12px] text-neutral-400">{page}</div>}
      <div className="pdf-hl-layer">
        {rects.map(({ id, color, r }, i) => (
          <div
            key={`${id}-${i}`}
            data-hl={id}
            className={cn(`hl-${color}`, activeId === id && "active")}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, pointerEvents: "none" }}
          />
        ))}
      </div>
      <div ref={textRef} className="textLayer" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function PdfEngine({ doc, initial }: { doc: Document; initial: string | null }) {
  const set = useReader((s) => s.set);
  const highlights = useReader((s) => s.highlights);
  const active = useReader((s) => s.activeHighlight);
  const find = useReader((s) => s.findQuery);
  const zoomSetting = useSettings((s) => s.values["reading.pdfZoom"]);
  const layout = useSettings((s) => s.values["reading.pdfLayout"]);
  const invertSetting = useSettings((s) => s.values["reading.pdfDarkInvert"]);
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState({ w: 612, h: 792 });
  const sizes = useRef(new Map<number, { w: number; h: number }>());
  const [sizeVersion, setSizeVersion] = useState(0);
  const [zoom, setZoom] = useState<ZoomMode>(zoomSetting);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [singlePage, setSinglePage] = useState(1);
  const restored = useRef(false);

  useEffect(() => {
    const mo = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette", "data-accent"] });
    return () => mo.disconnect();
  }, []);

  // Load document, first page size and outline.
  useEffect(() => {
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    openPdf(doc)
      .then(async (p) => {
        loaded = p;
        if (!alive) return p.loadingTask.destroy();
        const first = await p.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setBase({ w: vp.width, h: vp.height });
        setPdf(p);
        set({ pdf: p });
        // Resolve outline → page numbers.
        const outline = await p.getOutline().catch(() => null);
        if (outline && alive) {
          let count = 0;
          const resolve = async (items: typeof outline): Promise<TocItem[]> =>
            Promise.all(
              items.slice(0, 300).map(async (it) => {
                let locator: string | null = null;
                try {
                  if (count++ < 1500 && it.dest) {
                    const dest = typeof it.dest === "string" ? await p.getDestination(it.dest) : it.dest;
                    if (dest && dest[0]) locator = String((await p.getPageIndex(dest[0] as never)) + 1);
                  }
                } catch {
                  /* unresolvable entry */
                }
                return { label: it.title, locator, children: it.items?.length ? await resolve(it.items) : [] };
              }),
            );
          set({ toc: await resolve(outline) });
        }
        // Discover differing page sizes in the background for small/medium documents.
        if (p.numPages <= 400) {
          for (let n = 2; n <= p.numPages && alive; n++) {
            const pg = await p.getPage(n);
            const v = pg.getViewport({ scale: 1 });
            if (Math.abs(v.width - vp.width) > 0.5 || Math.abs(v.height - vp.height) > 0.5) {
              sizes.current.set(n, { w: v.width, h: v.height });
              if (n % 20 === 0) setSizeVersion((x) => x + 1);
            }
          }
          if (alive) setSizeVersion((x) => x + 1);
        }
      })
      .catch((e) => alive && setError(e?.message ?? String(e)));
    return () => {
      alive = false;
      loaded?.loadingTask.destroy();
      set({ pdf: null });
    };
  }, [doc, set]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf]);

  const sizeOf = useCallback((page: number) => sizes.current.get(page) ?? base, [base]);
  const scale = useMemo(() => {
    if (!box.w) return 1;
    if (typeof zoom === "number") return zoom * (96 / 72);
    const s = sizeOf(singlePage);
    const fw = (box.w - PAD * 2) / s.w;
    if (zoom === "fit-width") return Math.min(fw, 4);
    return Math.min(fw, (box.h - PAD * 2) / s.h);
  }, [zoom, box, sizeOf, singlePage]);

  const numPages = pdf?.numPages ?? 0;
  const virtualizer = useVirtualizer({
    count: layout === "continuous" ? numPages : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => sizeOf(i + 1).h * scale + GAP,
    overscan: 2,
    paddingStart: PAD,
    paddingEnd: PAD,
  });

  // Re-measure when the scale or known sizes change, keeping the reading position stable.
  const lastLoc = useRef<{ page: number; frac: number }>({ page: 1, frac: 0 });
  useEffect(() => {
    if (layout !== "continuous") return;
    const keep = lastLoc.current;
    virtualizer.measure();
    if (restored.current) requestAnimationFrame(() => scrollToPage(keep.page, keep.frac, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, sizeVersion, layout]);

  const scrollToPage = useCallback(
    (page: number, frac = 0, smooth = false) => {
      if (!pdf) return;
      const p = Math.min(Math.max(1, page), pdf.numPages);
      if (layout === "single") {
        setSinglePage(p);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: frac * (scrollRef.current.scrollHeight - scrollRef.current.clientHeight) }));
        return;
      }
      const offset = virtualizer.getOffsetForIndex(p - 1, "start")?.[0] ?? 0;
      const h = sizeOf(p).h * scale;
      scrollRef.current?.scrollTo({ top: offset + frac * h, behavior: smooth ? "smooth" : "auto" });
    },
    [pdf, layout, virtualizer, sizeOf, scale],
  );

  // Report location on scroll.
  const report = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !pdf) return;
    let page = singlePage, frac = 0;
    if (layout === "continuous") {
      const probe = el.scrollTop + el.clientHeight * 0.3;
      const item = virtualizer.getVirtualItems().find((v) => probe >= v.start && probe < v.end) ?? virtualizer.getVirtualItems()[0];
      if (!item) return;
      page = item.index + 1;
      frac = Math.min(1, Math.max(0, (el.scrollTop - item.start) / Math.max(1, item.size - GAP)));
    } else {
      frac = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
    }
    lastLoc.current = { page, frac };
    const n = pdf.numPages;
    set({
      location: {
        locator: `${page}@${frac.toFixed(3)}`,
        progress: n ? Math.min(1, (page - 1 + (layout === "single" ? 1 : frac)) / n) : 0,
        label: `Page ${page} of ${n}`,
        page,
        total: n,
        readKey: String(page),
      },
    });
  }, [pdf, layout, singlePage, virtualizer, set]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(report);
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => {
      el.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, [report]);
  useEffect(report, [report, singlePage]);

  // Restore initial position once the layout is known.
  useEffect(() => {
    if (!pdf || !box.w || restored.current) return;
    restored.current = true;
    const { page, frac } = parseLocator(initial ?? "1");
    lastLoc.current = { page, frac };
    requestAnimationFrame(() => {
      scrollToPage(page, frac);
      requestAnimationFrame(() => scrollToPage(page, frac));
    });
  }, [pdf, box.w, initial, scrollToPage]);

  const zoomBy = useCallback(
    (dir: 1 | -1 | 0) => {
      if (dir === 0) return setZoom("fit-width");
      const current = scale / (96 / 72);
      const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
      const next = dir > 0 ? steps.find((s) => s > current + 0.01) ?? 4 : [...steps].reverse().find((s) => s < current - 0.01) ?? 0.25;
      setZoom(next);
    },
    [scale],
  );

  // Register imperative API.
  useEffect(() => {
    if (!pdf) return;
    set({
      engine: {
        goTo: (loc) => {
          const { page, frac } = parseLocator(loc);
          scrollToPage(page, frac, false);
        },
        goToHighlight: (h) => {
          if (h.anchor.kind !== "pdf") return;
          const first = h.anchor.rects[0];
          scrollToPage(h.anchor.page, first ? Math.max(0, first.y - 0.05) : 0, false);
          set({ activeHighlight: null });
        },
        next: () => {
          if (layout === "single") scrollToPage(singlePage + 1);
          else scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.9, behavior: "smooth" });
        },
        prev: () => {
          if (layout === "single") scrollToPage(singlePage - 1);
          else scrollRef.current?.scrollBy({ top: -scrollRef.current.clientHeight * 0.9, behavior: "smooth" });
        },
        zoom: zoomBy,
        goToPage: (p) => scrollToPage(p),
        bookmarkTarget: () => {
          const l = lastLoc.current;
          return { locator: String(l.page), label: `Page ${l.page}`, sortKey: l.page };
        },
        clearSelection: () => window.getSelection()?.removeAllRanges(),
      },
    });
  }, [pdf, set, scrollToPage, layout, singlePage, zoomBy]);

  // Expose zoom state to the toolbar.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("bookshelf:pdf-zoom", { detail: { zoom, percent: Math.round((scale / (96 / 72)) * 100) } }));
  }, [zoom, scale]);
  useEffect(() => {
    const on = (e: Event) => setZoom((e as CustomEvent<ZoomMode>).detail);
    window.addEventListener("bookshelf:set-pdf-zoom", on);
    return () => window.removeEventListener("bookshelf:set-pdf-zoom", on);
  }, []);

  // Selection → pending highlight; click on highlight → open its popover.
  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      setTimeout(() => {
        const sel = window.getSelection();
        const root = scrollRef.current;
        if (!sel || !root) return;
        if (sel.isCollapsed || !sel.rangeCount) {
          const pageEl = (e.target as HTMLElement).closest<HTMLElement>("[data-page]");
          if (!pageEl) return set({ selection: null });
          const page = Number(pageEl.dataset.page);
          const b = pageEl.getBoundingClientRect();
          const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
          const hit = useReader.getState().highlights.find(
            (h) => h.anchor.kind === "pdf" && (h.anchor.rects as Rect[]).some((r) => (r.p ?? (h.anchor as { page: number }).page) === page && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
          );
          if (hit) {
            set({ activeHighlight: { id: hit.id, rect: { x: e.clientX - 1, y: e.clientY - 8, w: 2, h: 16 } }, selection: null });
          } else set({ selection: null, activeHighlight: null });
          return;
        }
        const range = sel.getRangeAt(0);
        const text = sel.toString().replace(/\s+\n/g, "\n").trim();
        if (!text) return;
        const pages = [...root.querySelectorAll<HTMLElement>("[data-page]")].filter((el) => range.intersectsNode(el));
        if (!pages.length) return;
        const rects: Rect[] = [];
        const clientRects = [...range.getClientRects()];
        for (const el of pages) {
          const page = Number(el.dataset.page);
          const b = el.getBoundingClientRect();
          for (const r of clientRects) {
            if (r.width < 1 || r.height < 1 || r.height > b.height * 0.15) continue;
            const x1 = Math.max(r.left, b.left), y1 = Math.max(r.top, b.top);
            const x2 = Math.min(r.right, b.right), y2 = Math.min(r.bottom, b.bottom);
            if (x2 <= x1 || y2 <= y1) continue;
            rects.push({ x: (x1 - b.left) / b.width, y: (y1 - b.top) / b.height, w: (x2 - x1) / b.width, h: (y2 - y1) / b.height, p: page });
          }
        }
        if (!rects.length) return;
        const firstPage = Number(pages[0].dataset.page);
        const layer = pages[0].querySelector(".textLayer");
        let start = 0, pageText = "";
        if (layer) {
          const pre = document.createRange();
          pre.setStart(layer, 0);
          try {
            pre.setEnd(range.startContainer, range.startOffset);
            start = pre.toString().length;
          } catch {
            start = 0;
          }
          pageText = layer.textContent ?? "";
        }
        const merged = mergeRects(rects);
        const bounds = range.getBoundingClientRect();
        set({
          activeHighlight: null,
          selection: {
            text,
            anchor: { kind: "pdf", page: firstPage, rects: merged, quote: quoteFrom(pageText, start, start + text.length), start },
            locator: String(firstPage),
            label: `Page ${firstPage}`,
            sortKey: firstPage + (merged[0]?.y ?? 0),
            rect: { x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height },
          },
        });
      }, 0);
    },
    [set],
  );

  const onSize = useCallback((page: number, w: number, h: number) => {
    sizes.current.set(page, { w, h });
    setSizeVersion((v) => v + 1);
  }, []);

  if (error) return <EngineError message={error} />;
  if (!pdf) return <EngineLoading />;

  const invert = invertSetting && dark;
  const pageHighlights = highlights;
  return (
    <div ref={scrollRef} className="relative h-full overflow-auto bg-bg-subtle" onMouseUp={onMouseUp}>
      {layout === "continuous" ? (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", minWidth: sizeOf(1).w * scale + PAD * 2 }}>
          {virtualizer.getVirtualItems().map((item) => {
            const s = sizeOf(item.index + 1);
            return (
              <div key={item.key} style={{ position: "absolute", top: item.start, left: 0, right: 0, height: item.size, display: "flex", justifyContent: "center" }}>
                <PdfPage
                  pdf={pdf}
                  page={item.index + 1}
                  scale={scale}
                  baseW={s.w}
                  baseH={s.h}
                  highlights={pageHighlights}
                  activeId={active?.id ?? null}
                  invert={invert}
                  find={find}
                  onSize={onSize}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-full items-start justify-center" style={{ padding: PAD }}>
          <PdfPage
            key={singlePage}
            pdf={pdf}
            page={singlePage}
            scale={scale}
            baseW={sizeOf(singlePage).w}
            baseH={sizeOf(singlePage).h}
            highlights={pageHighlights}
            activeId={active?.id ?? null}
            invert={invert}
            find={find}
            onSize={onSize}
          />
        </div>
      )}
    </div>
  );
}

/** Lazily rendered page thumbnails for the side panel. */
export function PdfThumbnails({ onPick, current }: { onPick: (page: number) => void; current: number }) {
  const pdf = useReader((s) => s.pdf);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: pdf?.numPages ?? 0, getScrollElement: () => ref.current, estimateSize: () => 196, overscan: 4 });
  useEffect(() => {
    if (current > 0) v.scrollToIndex(current - 1, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  if (!pdf) return null;
  return (
    <div ref={ref} className="h-full overflow-y-auto px-3 py-2">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => (
          <button
            key={it.key}
            onClick={() => onPick(it.index + 1)}
            className="absolute inset-x-0 flex flex-col items-center gap-1 py-2"
            style={{ top: it.start, height: it.size }}
          >
            <Thumb pdf={pdf} page={it.index + 1} active={current === it.index + 1} />
            <span className={cn("text-[11px] tabular-nums", current === it.index + 1 ? "font-semibold text-accent" : "text-subtle")}>{it.index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const Thumb = memo(function Thumb({ pdf, page, active }: { pdf: PDFDocumentProxy; page: number; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: ReturnType<pdfjs.PDFPageProxy["render"]> | null = null;
    let cancelled = false;
    pdf.getPage(page).then((p) => {
      if (cancelled || !ref.current) return;
      const vp1 = p.getViewport({ scale: 1 });
      const vp = p.getViewport({ scale: 220 / vp1.width });
      const c = ref.current;
      c.width = vp.width;
      c.height = vp.height;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      task = p.render({ canvas: c, canvasContext: ctx, viewport: vp });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page]);
  return <canvas ref={ref} className={cn("h-[150px] w-auto max-w-[110px] rounded-[3px] bg-white object-contain shadow-sm ring-1 ring-border", active && "ring-2 ring-accent")} />;
});
