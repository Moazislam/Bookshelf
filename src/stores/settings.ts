import { create } from "zustand";
import { api } from "@/services/api";

export type ThemeMode = "system" | "light" | "dark";
export type Accent = "ember" | "ink" | "moss" | "plum" | "slate";
export type ReadingTheme = "auto" | "light" | "sepia" | "dark";
export type LightPalette = "paper" | "snow" | "sepia" | "sage";
export type DarkPalette = "charcoal" | "midnight" | "oled" | "mocha";

/** Full colour themes. Swatches are used for the previews in Settings. */
export const LIGHT_PALETTES: { id: LightPalette; label: string; bg: string; surface: string; fg: string; border: string }[] = [
  { id: "paper", label: "Paper", bg: "#f7f5f0", surface: "#ffffff", fg: "#1f1d1a", border: "#e5e0d6" },
  { id: "snow", label: "Snow", bg: "#f6f7f9", surface: "#ffffff", fg: "#17191c", border: "#e2e5ea" },
  { id: "sepia", label: "Sepia", bg: "#f3ead8", surface: "#faf4e8", fg: "#3b2f22", border: "#dfd2b8" },
  { id: "sage", label: "Sage", bg: "#eef2ec", surface: "#fbfcfa", fg: "#1e261f", border: "#d7e0d3" },
];
export const DARK_PALETTES: { id: DarkPalette; label: string; bg: string; surface: string; fg: string; border: string }[] = [
  { id: "charcoal", label: "Charcoal", bg: "#151517", surface: "#1e1e22", fg: "#ebe8e2", border: "#2b2b31" },
  { id: "midnight", label: "Midnight", bg: "#0f1420", surface: "#172031", fg: "#e3e8f2", border: "#243049" },
  { id: "oled", label: "True black", bg: "#000000", surface: "#0e0e0f", fg: "#e8e6e1", border: "#1f1f22" },
  { id: "mocha", label: "Mocha", bg: "#1c1714", surface: "#27201b", fg: "#ece2d6", border: "#3a3029" },
];

export interface Settings {
  "appearance.theme": ThemeMode;
  "appearance.accent": Accent;
  "appearance.density": "comfortable" | "compact";
  "appearance.uiFont": "inter" | "system";
  "appearance.lightPalette": LightPalette;
  "appearance.darkPalette": DarkPalette;
  "comfort.enabled": boolean;
  "comfort.warmth": number; // 0..100
  "comfort.dim": number; // 0..60
  "comfort.schedule": "manual" | "scheduled";
  "comfort.from": string; // "HH:MM"
  "comfort.to": string;
  "reading.pdfZoom": "fit-width" | "fit-page" | number;
  "reading.pdfLayout": "continuous" | "single";
  "reading.pdfDarkInvert": boolean;
  "reading.font": "literata" | "serif" | "sans" | "publisher";
  "reading.fontSize": number; // percent
  "reading.lineHeight": number;
  "reading.align": "left" | "justify";
  "reading.margins": number; // 0..4
  "reading.theme": ReadingTheme;
  "reading.epubFlow": "paginated" | "scrolled";
  "reading.comicFit": "width" | "height" | "both";
  "reading.comicSpread": boolean;
  "library.folder": string | null;
  "library.copyOnImport": boolean;
  "library.extractText": boolean;
  "library.view": "grid" | "list";
  "library.sort": string;
  "dashboard.sections": Record<"continue" | "recent" | "collections" | "activity" | "stats", boolean>;
  "shortcuts": Record<string, string>;
  "profile.name": string;
}

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  search: "Ctrl+K",
  import: "Ctrl+O",
  toggleSidebar: "Ctrl+B",
  toggleTheme: "Ctrl+Shift+L",
  toggleEyeComfort: "Ctrl+Shift+E",
  readerLeftPanel: "Ctrl+[",
  readerRightPanel: "Ctrl+]",
  readerFind: "Ctrl+F",
  readerBookmark: "Ctrl+D",
  readerFullscreen: "F11",
  zoomIn: "Ctrl+=",
  zoomOut: "Ctrl+-",
};

export const DEFAULT_SETTINGS: Settings = {
  "appearance.theme": "system",
  "appearance.accent": "ember",
  "appearance.density": "comfortable",
  "appearance.uiFont": "inter",
  "appearance.lightPalette": "paper",
  "appearance.darkPalette": "charcoal",
  "comfort.enabled": false,
  "comfort.warmth": 45,
  "comfort.dim": 0,
  "comfort.schedule": "manual",
  "comfort.from": "21:00",
  "comfort.to": "07:00",
  "reading.pdfZoom": "fit-width",
  "reading.pdfLayout": "continuous",
  "reading.pdfDarkInvert": false,
  "reading.font": "literata",
  "reading.fontSize": 100,
  "reading.lineHeight": 1.65,
  "reading.align": "left",
  "reading.margins": 2,
  "reading.theme": "auto",
  "reading.epubFlow": "paginated",
  "reading.comicFit": "height",
  "reading.comicSpread": false,
  "library.folder": null,
  "library.copyOnImport": false,
  "library.extractText": true,
  "library.view": "grid",
  "library.sort": "added",
  "dashboard.sections": { continue: true, recent: true, collections: true, activity: true, stats: true },
  shortcuts: DEFAULT_SHORTCUTS,
  "profile.name": "",
};

interface SettingsState {
  values: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  values: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const stored = await api.getSettings();
      const values = { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
      values.shortcuts = { ...DEFAULT_SHORTCUTS, ...(values.shortcuts ?? {}) };
      values["dashboard.sections"] = { ...DEFAULT_SETTINGS["dashboard.sections"], ...(values["dashboard.sections"] ?? {}) };
      set({ values, loaded: true });
    } catch {
      set({ loaded: true });
    }
    applyAppearance(get().values);
  },
  set: (key, value) => {
    const values = { ...get().values, [key]: value };
    set({ values });
    if (key.startsWith("appearance.")) applyAppearance(values);
    api.setSetting(key, value).catch(() => {});
  },
}));

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSettings((s) => s.values[key]);
}

let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

export function applyAppearance(v: Settings) {
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const dark = v["appearance.theme"] === "dark" || (v["appearance.theme"] === "system" && mq.matches);
    root.classList.toggle("dark", dark);
    root.dataset.palette = dark ? v["appearance.darkPalette"] : v["appearance.lightPalette"];
  };
  apply();
  if (mediaListener) mq.removeEventListener("change", mediaListener);
  mediaListener = apply;
  mq.addEventListener("change", mediaListener);
  root.dataset.accent = v["appearance.accent"];
  root.dataset.density = v["appearance.density"];
  root.style.setProperty("--font-sans", v["appearance.uiFont"] === "system" ? "system-ui, 'Segoe UI', sans-serif" : "");
  try {
    localStorage.setItem("bookshelf.theme", v["appearance.theme"]);
    localStorage.setItem("bookshelf.accent", v["appearance.accent"]);
    localStorage.setItem("bookshelf.palettes", JSON.stringify([v["appearance.lightPalette"], v["appearance.darkPalette"]]));
  } catch {
    /* storage unavailable */
  }
}

export function isDarkActive() {
  return document.documentElement.classList.contains("dark");
}
