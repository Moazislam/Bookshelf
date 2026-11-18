import { useEffect, useRef } from "react";
import { api } from "@/services/api";
import { useReader } from "./store";

const IDLE_MS = 2 * 60 * 1000;
const PAGE_DWELL_MS = 4000;
const FLUSH_EVERY_MS = 5 * 60 * 1000;

/**
 * Measures real reading activity: seconds count only while the window is
 * visible and the user interacted within the last two minutes; a page counts
 * as read after it has been on screen for a few seconds. Sessions are flushed
 * periodically and on exit, so a crash loses at most a few minutes.
 */
export function useReadingSession(documentId: string | undefined) {
  const state = useRef({ start: Date.now(), active: 0, lastInput: Date.now(), pages: new Set<string>() });

  useEffect(() => {
    if (!documentId) return;
    const s = state.current;
    s.start = Date.now();
    s.active = 0;
    s.pages = new Set();
    s.lastInput = Date.now();

    const input = () => (s.lastInput = Date.now());
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, input, { passive: true }));
    // epub iframes swallow events; scrolling inside the reader still counts.
    document.addEventListener("scroll", input, { capture: true, passive: true });

    const tick = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - s.lastInput < IDLE_MS) s.active += 1;
    }, 1000);

    // Count a page once it has been the current location for a few seconds.
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const unsub = useReader.subscribe((st, prev) => {
      const key = st.location?.readKey;
      if (!key || key === prev.location?.readKey) return;
      clearTimeout(dwell);
      dwell = setTimeout(() => {
        if (useReader.getState().location?.readKey === key) s.pages.add(key);
      }, PAGE_DWELL_MS);
    });

    const flush = () => {
      const now = Date.now();
      if (s.active >= 5) {
        void api.recordReadingSession({ documentId, startedAt: s.start, endedAt: now, activeSeconds: s.active, pagesRead: s.pages.size });
      }
      s.start = now;
      s.active = 0;
      s.pages = new Set();
    };
    const periodic = setInterval(flush, FLUSH_EVERY_MS);
    window.addEventListener("beforeunload", flush);

    return () => {
      flush();
      clearInterval(tick);
      clearInterval(periodic);
      clearTimeout(dwell);
      unsub();
      events.forEach((e) => window.removeEventListener(e, input));
      document.removeEventListener("scroll", input, { capture: true });
      window.removeEventListener("beforeunload", flush);
    };
  }, [documentId]);
}
