import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { api, errorMessage } from "@/services/api";
import { useLibrary } from "@/stores/library";
import { cn, swatch, SWATCHES } from "@/utils";
import { toast } from "sonner";

export function TagChip({ name, color, onRemove, className }: { name: string; color: string; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-surface-2 pl-2 pr-2 text-[12px] text-fg", onRemove && "pr-1", className)}>
      <span className="size-1.5 rounded-full" style={{ background: swatch(color) }} />
      {name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="grid size-4 place-items-center rounded-full text-subtle hover:bg-border hover:text-fg" aria-label={`Remove ${name}`}>
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/** Inline tag editor: shows selected tags and lets you add existing or new ones. */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const tags = useLibrary((s) => s.tags);
  const refreshTags = useLibrary((s) => s.refreshTags);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const selected = tags.filter((t) => value.includes(t.id));
  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    return tags.filter((t) => !value.includes(t.id) && (!q || t.name.toLowerCase().includes(q))).slice(0, 8);
  }, [tags, value, input]);
  const exact = tags.find((t) => t.name.toLowerCase() === input.trim().toLowerCase());

  const add = async () => {
    const name = input.trim();
    if (!name) return;
    try {
      const tag = exact ?? (await api.createTag(name, Object.keys(SWATCHES)[tags.length % Object.keys(SWATCHES).length]));
      if (!value.includes(tag.id)) onChange([...value, tag.id]);
      setInput("");
      await refreshTags();
    } catch (e) {
      toast.error("Could not create tag", { description: errorMessage(e) });
    }
  };

  return (
    <div className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 shadow-sm focus-within:border-accent/70 focus-within:ring-3 focus-within:ring-ring/40">
        {selected.map((t) => (
          <TagChip key={t.id} name={t.name} color={t.color} onRemove={() => onChange(value.filter((v) => v !== t.id))} />
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            } else if (e.key === "Backspace" && !input && selected.length) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={selected.length ? "Add tag…" : "Type to add tags…"}
          className="h-6 min-w-24 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
        />
      </div>
      {focused && (suggestions.length > 0 || (input.trim() && !exact)) && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
          {suggestions.map((t) => (
            <button
              type="button"
              key={t.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange([...value, t.id]);
                setInput("");
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-bg-subtle"
            >
              <span className="size-2 rounded-full" style={{ background: swatch(t.color) }} />
              {t.name}
              <span className="ml-auto text-[11px] text-subtle">{t.documentCount}</span>
            </button>
          ))}
          {input.trim() && !exact && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void add()} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-accent hover:bg-bg-subtle">
              <Plus className="size-3.5" /> Create “{input.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
