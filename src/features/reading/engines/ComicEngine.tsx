import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fileUrl } from "@/services/api";
import { useReader } from "../store";
import { useSettings } from "@/stores/settings";
import { cn } from "@/utils";
import type { Document } from "@/types";
import { EngineError } from "./common";

export function ComicEngine({ doc, initial }: { doc: Document; initial: string | null }) {
  const set = useReader((s) => s.set);
  const fit = useSettings((s) => s.values["reading.comicFit"]);
  const spread = useSettings((s) => s.values["reading.comicSpread"]);
  const total = doc.pageCount ?? 0;
  const [page, setPage] = useState(() => Math.min(Math.max(1, parseInt(initial ?? "1", 10) || 1), Math.max(1, total)));
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // In spread mode the cover is shown alone, then pages pair up (2-3, 4-5, …).
  const pagesShown = useMemo(
    () => (spread && page > 1 && page < total ? [page % 2 === 0 ? page : page - 1, page % 2 === 0 ? page + 1 : page].filter((p) => p <= total) : [page]),
    [spread, page, total],
  );
  const step = spread && page > 1 ? 2 : 1;

  const goTo = useCallback((p: number) => setPage(Math.min(Math.max(1, p), Math.max(1, total))), [total]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    const last = pagesShown[pagesShown.length - 1];
    set({ location: { locator: String(page), progress: total ? last / total : 0, label: `Page ${pagesShown.join("–")} of ${total}`, page, total, readKey: String(page) } });
    // Preload upcoming pages.
    for (let i = 1; i <= 3; i++) if (last + i <= total) new Image().src = fileUrl.cbzPage(doc.id, last + i - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, spread, total, doc.id, set]);

  useEffect(() => {
    set({
      engine: {
        goTo: (loc) => goTo(parseInt(loc, 10) || 1),
        goToHighlight: () => {},
        next: () => goTo(pagesShown[pagesShown.length - 1] + 1),
        prev: () => goTo(page - step),
        bookmarkTarget: () => ({ locator: String(page), label: `Page ${page}`, sortKey: page }),
      },
    });
  }, [set, goTo, page, step, pagesShown]);

  if (!total) return <EngineError message="This comic archive has no readable pages." />;
  if (failed) return <EngineError message="The comic pages could not be loaded. The file may have been moved." />;

  const imgCls = cn(
    "select-none shadow-lg",
    fit === "width" && "w-full h-auto",
    fit === "height" && "h-full w-auto max-w-none",
    fit === "both" && "max-h-full max-w-full object-contain",
  );

  return (
    <div
      ref={scrollRef}
      className={cn("relative h-full bg-[#111] text-white", fit === "width" ? "overflow-y-auto" : "overflow-auto")}
      onClick={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - b.left) / b.width;
        if (x < 0.3) goTo(page - step);
        else if (x > 0.7) goTo(pagesShown[pagesShown.length - 1] + 1);
      }}
    >
      <div className={cn("flex min-h-full justify-center gap-1 p-4", fit !== "width" && "h-full items-center")}>
        {pagesShown.map((p) => (
          <img
            key={p}
            src={fileUrl.cbzPage(doc.id, p - 1)}
            alt={`Page ${p}`}
            draggable={false}
            onError={() => setFailed(true)}
            className={cn(imgCls, pagesShown.length > 1 && fit !== "height" && "max-w-[50%]")}
          />
        ))}
      </div>
    </div>
  );
}

export function ComicThumbnails({ doc, current, onPick }: { doc: Document; current: number; onPick: (p: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: doc.pageCount ?? 0, getScrollElement: () => ref.current, estimateSize: () => 196, overscan: 4 });
  useEffect(() => {
    if (current > 0) v.scrollToIndex(current - 1, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  return (
    <div ref={ref} className="h-full overflow-y-auto px-3 py-2">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => (
          <button key={it.key} onClick={() => onPick(it.index + 1)} className="absolute inset-x-0 flex flex-col items-center gap-1 py-2" style={{ top: it.start, height: it.size }}>
            <img src={fileUrl.cbzPage(doc.id, it.index)} loading="lazy" alt="" className={cn("h-[150px] w-auto max-w-[110px] rounded-[3px] object-cover shadow-sm ring-1 ring-border", current === it.index + 1 && "ring-2 ring-accent")} />
            <span className={cn("text-[11px] tabular-nums", current === it.index + 1 ? "font-semibold text-accent" : "text-subtle")}>{it.index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
