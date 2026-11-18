import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, MessageSquare, StickyNote, Trash } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/services/api";
import { useReader, HIGHLIGHT_COLORS, HL_SWATCH } from "./store";
import { Button, Textarea, Tooltip } from "@/components/ui";
import { cn } from "@/utils";
import type { HighlightColor } from "@/types";

/** Position a floating panel above (or below) a viewport rect, clamped to the window. */
function useFloating(rect: { x: number; y: number; w: number; h: number } | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!rect || !ref.current) return;
    const el = ref.current.getBoundingClientRect();
    let top = rect.y - el.height - 10;
    if (top < 60) top = rect.y + rect.h + 10;
    const left = Math.min(Math.max(8, rect.x + rect.w / 2 - el.width / 2), window.innerWidth - el.width - 8);
    setPos({ left, top: Math.min(top, window.innerHeight - el.height - 8) });
  }, [rect?.x, rect?.y, rect?.w, rect?.h]);
  return { ref, style: pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 } };
}

function ColorDots({ value, onPick }: { value?: HighlightColor; onPick: (c: HighlightColor) => void }) {
  return (
    <div className="flex items-center gap-1">
      {HIGHLIGHT_COLORS.map((c) => (
        <Tooltip key={c} content={c[0].toUpperCase() + c.slice(1)} side="top">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            aria-label={`Highlight ${c}`}
            className={cn("size-6 rounded-full border-2 border-surface shadow-sm transition-transform hover:scale-110", value === c && "ring-2 ring-fg/50")}
            style={{ background: HL_SWATCH[c] }}
          />
        </Tooltip>
      ))}
    </div>
  );
}

export function SelectionPopover() {
  const selection = useReader((s) => s.selection);
  const doc = useReader((s) => s.doc);
  const engine = useReader((s) => s.engine);
  const set = useReader((s) => s.set);
  const lastColor = useReader((s) => s.lastColor);
  const { ref, style } = useFloating(selection?.rect);
  if (!selection || !doc) return null;

  const create = async (color: HighlightColor, withComment = false) => {
    try {
      const h = await api.createHighlight({
        documentId: doc.id,
        locator: selection.locator,
        label: selection.label,
        anchor: selection.anchor,
        text: selection.text,
        color,
        sortKey: selection.sortKey,
      });
      const highlights = [...useReader.getState().highlights, h].sort((a, b) => a.sortKey - b.sortKey);
      set({ highlights, selection: null, lastColor: color, activeHighlight: withComment ? { id: h.id, rect: selection.rect } : null });
      engine?.clearSelection?.();
    } catch (e) {
      toast.error("Could not save highlight", { description: errorMessage(e) });
    }
  };

  return (
    <div ref={ref} style={style} className="fixed z-50 flex items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-lg animate-scale-in" onMouseDown={(e) => e.preventDefault()}>
      {doc.format === "cbz" ? null : <ColorDots onPick={(c) => create(c)} />}
      <span className="mx-1 h-5 w-px bg-border" />
      <Tooltip content="Highlight & comment" side="top">
        <Button variant="ghost" size="icon-sm" onClick={() => create(lastColor, true)} aria-label="Highlight and add comment">
          <MessageSquare />
        </Button>
      </Tooltip>
      <Tooltip content="Copy" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy"
          onClick={() => {
            void navigator.clipboard.writeText(selection.text);
            toast.success("Copied to clipboard");
            set({ selection: null });
          }}
        >
          <Copy />
        </Button>
      </Tooltip>
    </div>
  );
}

export function HighlightPopover({ onAddNote }: { onAddNote: (highlightId: string) => void }) {
  const active = useReader((s) => s.activeHighlight);
  const highlights = useReader((s) => s.highlights);
  const set = useReader((s) => s.set);
  const h = highlights.find((x) => x.id === active?.id);
  const [comment, setComment] = useState("");
  const { ref, style } = useFloating(active?.rect);
  useEffect(() => setComment(h?.comment ?? ""), [h?.id, h?.comment]);
  if (!active || !h) return null;

  const update = async (color?: HighlightColor, c?: string) => {
    try {
      const updated = await api.updateHighlight(h.id, color, c);
      set({ highlights: useReader.getState().highlights.map((x) => (x.id === h.id ? updated : x)) });
    } catch (e) {
      toast.error("Could not update highlight", { description: errorMessage(e) });
    }
  };
  const remove = async () => {
    try {
      await api.deleteHighlight(h.id);
      set({ highlights: useReader.getState().highlights.filter((x) => x.id !== h.id), activeHighlight: null });
      toast("Highlight deleted", {
        action: {
          label: "Undo",
          onClick: async () => {
            const restored = await api.createHighlight({ documentId: h.documentId, locator: h.locator, label: h.label, anchor: h.anchor, text: h.text, color: h.color, comment: h.comment, sortKey: h.sortKey });
            set({ highlights: [...useReader.getState().highlights, restored].sort((a, b) => a.sortKey - b.sortKey) });
          },
        },
      });
    } catch (e) {
      toast.error("Could not delete highlight", { description: errorMessage(e) });
    }
  };

  return (
    <div ref={ref} style={style} className="fixed z-50 w-72 rounded-xl border border-border bg-surface p-3 shadow-lg animate-scale-in">
      <div className="flex items-center justify-between">
        <ColorDots value={h.color} onPick={(c) => update(c)} />
        <div className="flex">
          <Tooltip content="Add a note" side="top">
            <Button variant="ghost" size="icon-sm" onClick={() => onAddNote(h.id)} aria-label="Add a note"><StickyNote /></Button>
          </Tooltip>
          <Tooltip content="Delete highlight" side="top">
            <Button variant="ghost" size="icon-sm" onClick={remove} aria-label="Delete highlight" className="hover:text-danger"><Trash /></Button>
          </Tooltip>
        </div>
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onBlur={() => comment !== (h.comment ?? "") && update(undefined, comment)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            void update(undefined, comment);
            set({ activeHighlight: null });
          }
          if (e.key === "Escape") set({ activeHighlight: null });
        }}
        placeholder="Add a comment…"
        className="mt-2.5 min-h-16 text-[13px]"
        autoFocus={!h.comment}
      />
      <p className="mt-1.5 text-[11px] text-subtle">Saved automatically · Ctrl+Enter to close</p>
    </div>
  );
}
