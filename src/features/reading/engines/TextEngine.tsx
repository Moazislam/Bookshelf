import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api } from "@/services/api";
import { useReader, locateQuote, quoteFrom } from "../store";
import { EngineError, EngineLoading, FONT_STACKS, readingPalette, useTypography } from "./common";
import type { Document } from "@/types";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) out.push(w.currentNode as Text);
  return out;
}

/** Wrap [start,end) (offsets into root.textContent) in <mark> elements. */
function wrapRange(root: HTMLElement, start: number, end: number, make: () => HTMLElement) {
  let pos = 0;
  for (const node of textNodes(root)) {
    const len = node.data.length;
    const s = Math.max(start, pos), e = Math.min(end, pos + len);
    if (s < e) {
      let target = node;
      if (s > pos) target = target.splitText(s - pos);
      if (e < pos + len) target.splitText(e - s);
      const mark = make();
      target.parentNode!.insertBefore(mark, target);
      mark.appendChild(target);
    }
    pos += len;
    if (pos >= end) break;
  }
}

function offsetOf(root: HTMLElement, node: Node, offset: number) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

function pointFromOffset(root: HTMLElement, target: number): { node: Text; offset: number } | null {
  let pos = 0;
  for (const node of textNodes(root)) {
    if (pos + node.data.length >= target) return { node, offset: Math.max(0, target - pos) };
    pos += node.data.length;
  }
  return null;
}

export function TextEngine({ doc, initial }: { doc: Document; initial: string | null }) {
  const set = useReader((s) => s.set);
  const highlights = useReader((s) => s.highlights);
  const findQuery = useReader((s) => s.findQuery);
  const active = useReader((s) => s.activeHighlight);
  const typo = useTypography();
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const lastOffset = useRef(0);
  const [, setDarkTick] = useState(0);

  useEffect(() => {
    const mo = new MutationObserver(() => setDarkTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette", "data-accent"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .readTextDocument(doc.id)
      .then((t) => alive && setSource(t))
      .catch((e) => alive && setError(typeof e === "string" ? e : e?.message ?? "Could not read file"));
    return () => {
      alive = false;
    };
  }, [doc.id]);

  const html = useMemo(() => {
    if (source === null) return "";
    if (doc.format === "md") return DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }) as string);
    return `<div style="white-space:pre-wrap">${escapeHtml(source)}</div>`;
  }, [source, doc.format]);

  // Build TOC from markdown headings.
  useEffect(() => {
    const root = contentRef.current;
    if (!root || !html) return;
    const heads = [...root.querySelectorAll("h1,h2,h3")];
    set({
      toc: heads.map((h) => ({ label: h.textContent ?? "", locator: `c${offsetOf(root, h, 0)}`, children: [] })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  // Render content + highlight / find marks.
  useLayoutEffect(() => {
    const root = contentRef.current;
    if (!root || source === null) return;
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    root.innerHTML = html;
    const full = root.textContent ?? "";
    for (const h of highlights) {
      if (h.anchor.kind !== "text") continue;
      let { start, end } = h.anchor;
      if (full.slice(start, end) !== h.anchor.quote.exact) {
        const found = locateQuote(full, h.anchor.quote, start);
        if (found < 0) continue;
        start = found;
        end = found + h.anchor.quote.exact.length;
      }
      wrapRange(root, start, end, () => {
        const m = document.createElement("mark");
        m.className = `bs-hl hl-${h.color}`;
        m.dataset.id = h.id;
        if (active?.id === h.id) m.style.outline = "2px solid var(--accent)";
        return m;
      });
    }
    const q = findQuery.trim().toLowerCase();
    if (q.length >= 2) {
      const lower = (root.textContent ?? "").toLowerCase();
      const hits: number[] = [];
      for (let i = lower.indexOf(q); i !== -1 && hits.length < 500; i = lower.indexOf(q, i + q.length)) hits.push(i);
      for (const i of hits.reverse()) wrapRange(root, i, i + q.length, () => Object.assign(document.createElement("mark"), { className: "bs-search" }));
    }
    if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
  }, [html, highlights, findQuery, active?.id, source]);

  const scrollToOffset = useCallback((offset: number, smooth = false) => {
    const root = contentRef.current, sc = scrollRef.current;
    if (!root || !sc) return;
    const p = pointFromOffset(root, offset);
    if (!p) return;
    const r = document.createRange();
    r.setStart(p.node, p.offset);
    r.setEnd(p.node, Math.min(p.node.data.length, p.offset + 1));
    const rect = r.getBoundingClientRect();
    const top = sc.scrollTop + rect.top - sc.getBoundingClientRect().top - 40;
    sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, []);

  const report = useCallback(() => {
    const sc = scrollRef.current, root = contentRef.current;
    if (!sc || !root) return;
    const b = sc.getBoundingClientRect();
    const cr = root.getBoundingClientRect();
    const caret = (document as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(cr.left + 4, Math.max(b.top + 8, cr.top + 2));
    let offset = lastOffset.current;
    if (caret && root.contains(caret.startContainer)) offset = offsetOf(root, caret.startContainer, caret.startOffset);
    lastOffset.current = offset;
    const max = sc.scrollHeight - sc.clientHeight;
    const progress = max > 0 ? sc.scrollTop / max : 1;
    const screen = Math.floor(sc.scrollTop / Math.max(1, sc.clientHeight));
    const total = Math.max(1, Math.ceil(sc.scrollHeight / Math.max(1, sc.clientHeight)));
    set({ location: { locator: `c${offset}`, progress, label: `${Math.round(progress * 100)}%`, page: screen + 1, total, readKey: String(screen) } });
  }, [set]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(report);
    };
    sc.addEventListener("scroll", on, { passive: true });
    return () => sc.removeEventListener("scroll", on);
  }, [report, source]);

  // Locators: "c123" = offset into rendered text; plain numbers = offset into the source file (search hits).
  const resolve = useCallback(
    (loc: string): number => {
      if (loc.startsWith("c")) return Number(loc.slice(1)) || 0;
      const n = Number(loc) || 0;
      if (doc.format === "txt" || !source) return n;
      const renderedLen = contentRef.current?.textContent?.length ?? source.length;
      return Math.round((n / Math.max(1, source.length)) * renderedLen);
    },
    [doc.format, source],
  );

  useEffect(() => {
    if (source === null || restored.current) return;
    restored.current = true;
    requestAnimationFrame(() => {
      if (initial) scrollToOffset(resolve(initial));
      report();
    });
  }, [source, initial, scrollToOffset, resolve, report]);

  useEffect(() => {
    if (source === null) return;
    set({
      engine: {
        goTo: (loc) => {
          scrollToOffset(resolve(loc));
          // If a find query is active, jump to the nearest match after the target.
          setTimeout(() => {
            const marks = contentRef.current?.querySelectorAll<HTMLElement>("mark.bs-search");
            const sc = scrollRef.current;
            if (marks?.length && sc) {
              const top = sc.getBoundingClientRect().top;
              const next = [...marks].find((m) => m.getBoundingClientRect().top >= top - 5) ?? marks[0];
              next.scrollIntoView({ block: "center" });
            }
          }, 30);
        },
        goToHighlight: (h) => {
          const el = contentRef.current?.querySelector<HTMLElement>(`mark[data-id="${h.id}"]`);
          if (el) el.scrollIntoView({ block: "center" });
          else if (h.anchor.kind === "text") scrollToOffset(h.anchor.start);
          set({ activeHighlight: null });
        },
        next: () => scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.9, behavior: "smooth" }),
        prev: () => scrollRef.current?.scrollBy({ top: -scrollRef.current.clientHeight * 0.9, behavior: "smooth" }),
        clearSelection: () => window.getSelection()?.removeAllRanges(),
        bookmarkTarget: () => {
          const loc = useReader.getState().location;
          const root = contentRef.current;
          const snippet = (root?.textContent ?? "").slice(lastOffset.current, lastOffset.current + 48).trim().replace(/\s+/g, " ");
          return { locator: `c${lastOffset.current}`, label: snippet ? `“${snippet}…”` : loc?.label ?? "Bookmark", sortKey: lastOffset.current };
        },
      },
    });
  }, [source, set, scrollToOffset, resolve]);

  const onMouseUp = (e: React.MouseEvent) => {
    setTimeout(() => {
      const root = contentRef.current;
      const sel = window.getSelection();
      if (!root || !sel) return;
      if (sel.isCollapsed) {
        const mark = (e.target as HTMLElement).closest<HTMLElement>("mark.bs-hl");
        if (mark?.dataset.id) {
          const b = mark.getBoundingClientRect();
          set({ activeHighlight: { id: mark.dataset.id, rect: { x: b.left, y: b.top, w: b.width, h: b.height } }, selection: null });
        } else set({ selection: null, activeHighlight: null });
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const raw = range.toString();
      if (!raw.trim()) return;
      const start = offsetOf(root, range.startContainer, range.startOffset);
      const end = start + raw.length;
      const full = root.textContent ?? "";
      const b = range.getBoundingClientRect();
      const heading = [...root.querySelectorAll("h1,h2,h3")].filter((h) => offsetOf(root, h, 0) <= start).pop()?.textContent ?? null;
      set({
        activeHighlight: null,
        selection: {
          text: raw.trim(),
          anchor: { kind: "text", start, end, quote: quoteFrom(full, start, end) },
          locator: `c${start}`,
          label: heading,
          sortKey: start,
          rect: { x: b.left, y: b.top, w: b.width, h: b.height },
        },
      });
    }, 0);
  };

  if (error) return <EngineError message={error} />;
  if (source === null) return <EngineLoading />;

  const pal = readingPalette(typo.theme);
  const pad = [12, 32, 56, 88, 128][typo.margins] ?? 56;
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto transition-colors" style={{ background: pal.bg, color: pal.fg }} onMouseUp={onMouseUp}>
      <div className="mx-auto max-w-[760px] py-14" style={{ paddingInline: pad }}>
        <div
          ref={contentRef}
          className="prose-reader selectable"
          style={{
            fontFamily: FONT_STACKS[typo.font] || undefined,
            fontSize: `${(18 * typo.fontSize) / 100}px`,
            lineHeight: typo.lineHeight,
            textAlign: typo.align,
            ["--accent" as string]: pal.link,
          }}
        />
      </div>
    </div>
  );
}
