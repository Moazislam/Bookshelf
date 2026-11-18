import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { DocFormat, ReadingStatus } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "Never";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  if (abs < min) return "Just now";
  if (abs < hour) return rtf.format(Math.round(diff / min), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), "day");
  return formatDate(ms);
}

export function formatDate(ms: number, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Date(ms).toLocaleDateString(undefined, opts);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export const FORMAT_LABEL: Record<DocFormat, string> = {
  pdf: "PDF",
  epub: "EPUB",
  txt: "Text",
  md: "Markdown",
  cbz: "Comic",
};

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  completed: "Completed",
  on_hold: "On hold",
  abandoned: "Abandoned",
};
export const STATUSES: ReadingStatus[] = ["unread", "reading", "completed", "on_hold", "abandoned"];

/** Palette used for collections and tags; values are CSS colours that read well on both themes. */
export const SWATCHES: Record<string, string> = {
  slate: "#7c8593",
  ember: "#c8693f",
  amber: "#c99a2e",
  moss: "#5f8f68",
  teal: "#3f8f8a",
  ink: "#5a77c0",
  plum: "#9467a8",
  rose: "#c45b72",
};
export const swatch = (name: string) => SWATCHES[name] ?? SWATCHES.slate;

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Split a search snippet with \u0001 / \u0002 markers into safe React parts. */
export function snippetParts(snippet: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  const re = /\u0001([\s\S]*?)\u0002/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet))) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), hit: false });
    parts.push({ text: m[1], hit: true });
    last = re.lastIndex;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false });
  return parts;
}

export function initials(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** Deterministic pleasant colour pair for generated covers. */
export function coverPalette(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const palettes: [string, string][] = [
    ["#2f3e46", "#cad2c5"],
    ["#6b2d2d", "#f2d7c9"],
    ["#1f3a5f", "#d9e4f2"],
    ["#3d405b", "#f4f1de"],
    ["#4a3f35", "#efe3d0"],
    ["#264653", "#e9f5f2"],
    ["#5b3758", "#f3e1ef"],
    ["#3c4a2f", "#e6ecd8"],
  ];
  return palettes[h % palettes.length];
}

export function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}
