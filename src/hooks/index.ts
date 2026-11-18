import { useEffect, useRef, useState } from "react";
import { useUI } from "@/stores/ui";
import { useSettings, DEFAULT_SHORTCUTS } from "@/stores/settings";
import { isTypingTarget } from "@/utils";

export function useBreadcrumbs(crumbs: { label: string; to?: string }[]) {
  const set = useUI((s) => s.setBreadcrumbs);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, set]);
}

/** "Ctrl+Shift+K" → matches a KeyboardEvent (Ctrl also matches ⌘ on macOS). */
export function matchesShortcut(e: KeyboardEvent, binding: string | undefined): boolean {
  if (!binding) return false;
  const parts = binding.split("+").map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? "";
  const want = { ctrl: parts.includes("ctrl"), shift: parts.includes("shift"), alt: parts.includes("alt") };
  if ((e.ctrlKey || e.metaKey) !== want.ctrl || e.altKey !== want.alt) return false;
  const k = e.key.toLowerCase();
  // Shift changes the produced character for symbols, so only enforce it for letters / named keys.
  if (/^[a-z]$|^f\d+$|^arrow|^page|^home$|^end$|^escape$|^enter$/.test(key) && e.shiftKey !== want.shift) return false;
  if (key === "=" && (k === "=" || k === "+")) return true;
  if (key === "space") return k === " ";
  return k === key;
}

export function formatShortcut(binding: string) {
  return binding.replace(/Ctrl/g, navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl");
}

/** Bind a configurable shortcut by its action name. */
export function useShortcut(action: keyof typeof DEFAULT_SHORTCUTS | string, handler: (e: KeyboardEvent) => void, opts: { allowInInputs?: boolean; enabled?: boolean } = {}) {
  const binding = useSettings((s) => s.values.shortcuts[action] ?? DEFAULT_SHORTCUTS[action]);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (opts.enabled === false) return;
    const onKey = (e: KeyboardEvent) => {
      if (!opts.allowInInputs && isTypingTarget(e) && !(e.ctrlKey || e.metaKey)) return;
      if (matchesShortcut(e, binding)) {
        e.preventDefault();
        ref.current(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [binding, opts.allowInInputs, opts.enabled]);
}

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Async loader with loading / error state and a manual reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e) => alive && setState({ data: null, loading: false, error: typeof e === "string" ? e : e?.message ?? "Failed to load" }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1), setData: (data: T) => setState((s) => ({ ...s, data })) };
}
