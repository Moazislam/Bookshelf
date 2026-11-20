import { FileWarning } from "lucide-react";
import { Spinner } from "@/components/ui";
import { useSettings, type ReadingTheme } from "@/stores/settings";

export function EngineLoading({ label = "Opening document…" }: { label?: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-3 text-[13px] text-muted">
        <Spinner /> {label}
      </div>
    </div>
  );
}

export function EngineError({ message }: { message: string }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border border-border bg-surface">
          <FileWarning className="size-5 text-danger" />
        </div>
        <h3 className="font-serif text-lg font-medium">This document could not be opened</h3>
        <p className="mt-2 text-[13px] text-muted">{message}</p>
        <p className="mt-1 text-[12px] text-subtle">The file may be damaged, password-protected, or moved. Use “Locate file…” from its menu if it was moved.</p>
      </div>
    </div>
  );
}

export interface ReadingPalette {
  bg: string;
  fg: string;
  muted: string;
  link: string;
}

/** Resolve the reading theme (auto follows the app theme). */
export function readingPalette(theme: ReadingTheme): ReadingPalette {
  if (theme === "auto") {
    // Follow the active colour theme (Paper, Midnight, Sepia, …).
    const css = getComputedStyle(document.documentElement);
    const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    return { bg: v("--reading-bg", "#fffdf9"), fg: v("--reading-fg", "#24211d"), muted: v("--reading-muted", "#6c675f"), link: v("--accent", "#a5502b") };
  }
  const t = theme;
  switch (t) {
    case "sepia":
      return { bg: "#f4ecd8", fg: "#4a3b28", muted: "#7d6b52", link: "#9a5b2b" };
    case "dark":
      return { bg: "#18181b", fg: "#dedbd4", muted: "#9a968e", link: "#e0a37f" };
    default:
      return { bg: "#fffdf9", fg: "#24211d", muted: "#6c675f", link: "#a5502b" };
  }
}

export const FONT_STACKS: Record<string, string> = {
  literata: "'Literata Variable', Georgia, serif",
  serif: "'Source Serif 4 Variable', Georgia, 'Times New Roman', serif",
  sans: "'Inter Variable', 'Segoe UI', system-ui, sans-serif",
  publisher: "",
};

export function useTypography() {
  const v = useSettings((s) => s.values);
  return {
    font: v["reading.font"],
    fontSize: v["reading.fontSize"],
    lineHeight: v["reading.lineHeight"],
    align: v["reading.align"],
    margins: v["reading.margins"],
    theme: v["reading.theme"],
  };
}
