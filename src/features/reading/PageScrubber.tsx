import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/utils";
import { useReader } from "./store";

const HIDE_AFTER_MS = 1500;
const THUMB_H = 40;
/** Location reports during the first moments after opening are the restore, not the reader scrolling. */
const SETTLE_MS = 1000;
/** Minimum gap between jumps while dragging (EPUB re-renders on every jump). */
const JUMP_EVERY_MS = 60;

/**
 * A draggable page thumb on the right edge of the reader. It appears while the
 * position changes (scrolling, page turns), shows "page / total" in a bubble,
 * and jumps to the dragged-to page. Engines opt in by implementing `goToPage`.
 */
export function PageScrubber() {
  const location = useReader((s) => s.location);
  const goToPage = useReader((s) => s.engine?.goToPage);
  const page = location?.page;
  const total = location?.total;

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackH, setTrackH] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dragPage, setDragPage] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hovering = useRef(false);
  const mountedAt = useRef(Date.now());
  const lastJump = useRef({ at: 0, page: 0 });
  const trailing = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!hovering.current) setVisible(false);
    }, HIDE_AFTER_MS);
  }, []);

  const reveal = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  // Show while the reading position changes.
  useEffect(() => {
    if (!location || Date.now() - mountedAt.current < SETTLE_MS) return;
    reveal();
  }, [location, reveal]);

  useEffect(
    () => () => {
      clearTimeout(hideTimer.current);
      clearTimeout(trailing.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTrackH(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [goToPage, total]);

  if (!goToPage || !page || !total || total < 2) return null;

  const pageAt = (clientY: number) => {
    const b = trackRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - b.top - THUMB_H / 2) / Math.max(1, b.height - THUMB_H)));
    return Math.round(f * (total - 1)) + 1;
  };

  const jump = (p: number, force = false) => {
    clearTimeout(trailing.current);
    const now = Date.now();
    if (p === lastJump.current.page && !force) return;
    if (!force && now - lastJump.current.at < JUMP_EVERY_MS) {
      trailing.current = setTimeout(() => jump(p, true), JUMP_EVERY_MS);
      return;
    }
    lastJump.current = { at: now, page: p };
    goToPage(p);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    clearTimeout(hideTimer.current);
    setVisible(true);
    lastJump.current = { at: 0, page };
    const p = pageAt(e.clientY);
    setDragPage(p);
    jump(p);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragPage === null) return;
    const p = pageAt(e.clientY);
    if (p !== dragPage) setDragPage(p);
    jump(p);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragPage === null) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    jump(dragPage, true);
    setDragPage(null);
    scheduleHide();
  };

  const shown = dragPage ?? page;
  const y = ((shown - 1) / (total - 1)) * Math.max(0, trackH - THUMB_H);
  const dragging = dragPage !== null;

  return (
    <div
      className={cn(
        "absolute inset-y-3 right-0 z-30 w-9 touch-none select-none transition-opacity duration-200 md:right-2.5",
        visible || dragging ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      role="slider"
      aria-label="Page"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={shown}
      aria-valuetext={`${shown} of ${total}`}
      aria-hidden={!visible && !dragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => {
        hovering.current = true;
        clearTimeout(hideTimer.current);
      }}
      onPointerLeave={() => {
        hovering.current = false;
        if (!dragging) scheduleHide();
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div ref={trackRef} className="relative h-full cursor-pointer">
        <div className="absolute inset-y-0 right-[15px] w-0.5 rounded-full bg-border/80" />
        {/* Only the thumb column takes input; the bubble must not block the page underneath. */}
        <div className="pointer-events-none absolute right-0 top-0 flex items-center will-change-transform" style={{ height: THUMB_H, transform: `translateY(${y}px)` }}>
          <div
            className={cn(
              "pointer-events-none mr-2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[12px] font-medium tabular-nums shadow-md transition-transform duration-150",
              dragging ? "scale-105" : "scale-100",
            )}
          >
            {shown} <span className="text-muted">/ {total}</span>
          </div>
          <div className="grid h-full w-[32px] place-items-center">
            <div
              className={cn("h-full w-1.5 rounded-full bg-[var(--accent)] shadow-sm transition-transform duration-150", dragging ? "scale-x-[1.6]" : "scale-x-100")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
