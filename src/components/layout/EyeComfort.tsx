import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useSettings } from "@/stores/settings";
import { useShortcut } from "@/hooks";
import { Button, Popover, PopoverContent, PopoverTrigger, SegmentedControl, Slider, Switch } from "@/components/ui";
import { cn } from "@/utils";

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Is `now` inside a daily window that may wrap past midnight (e.g. 21:00 → 07:00)? */
export function inWindow(from: string, to: string, now = new Date()) {
  const n = now.getHours() * 60 + now.getMinutes();
  const a = toMinutes(from), b = toMinutes(to);
  return a <= b ? n >= a && n < b : n >= a || n < b;
}

/** Whether eye comfort is currently on, either manually or by schedule. Re-evaluated every minute. */
export function useEyeComfortActive() {
  const enabled = useSettings((s) => s.values["comfort.enabled"]);
  const schedule = useSettings((s) => s.values["comfort.schedule"]);
  const from = useSettings((s) => s.values["comfort.from"]);
  const to = useSettings((s) => s.values["comfort.to"]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (schedule !== "scheduled") return;
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, [schedule]);
  void tick;
  const scheduled = schedule === "scheduled" && inWindow(from, to);
  return { active: enabled || scheduled, scheduled, enabled };
}

/** Full-window warm filter + dimmer. Sits above everything, including EPUB iframes, without blocking input. */
export function EyeComfortOverlay() {
  const { active } = useEyeComfortActive();
  const warmth = useSettings((s) => s.values["comfort.warmth"]);
  const dim = useSettings((s) => s.values["comfort.dim"]);
  const set = useSettings((s) => s.set);
  const enabled = useSettings((s) => s.values["comfort.enabled"]);
  useShortcut("toggleEyeComfort", () => set("comfort.enabled", !enabled), { allowInInputs: true });
  return (
    <>
      <div aria-hidden className="eye-comfort-layer eye-comfort-warm" style={{ opacity: active ? (warmth / 100) * 0.42 : 0 }} />
      <div aria-hidden className="eye-comfort-layer eye-comfort-dim" style={{ opacity: active ? dim / 100 : 0 }} />
    </>
  );
}

export function EyeComfortControls({ compact }: { compact?: boolean }) {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const { active, scheduled } = useEyeComfortActive();
  return (
    <div className={cn("space-y-4 text-[13px]", compact ? "w-72" : "")}>
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="font-medium">Eye comfort</span>
          <span className="block text-[12px] text-muted">{scheduled && !v["comfort.enabled"] ? "On by schedule right now" : "Warmer colours, less blue light"}</span>
        </span>
        <Switch checked={v["comfort.enabled"]} onChange={(x) => set("comfort.enabled", x)} label="Eye comfort" />
      </label>
      <div className={cn(!active && "opacity-60")}>
        <div className="mb-1.5 flex justify-between text-[12px] font-medium text-subtle"><span>Warmth</span><span className="tabular-nums">{v["comfort.warmth"]}%</span></div>
        <Slider value={v["comfort.warmth"]} min={0} max={100} step={5} onChange={(x) => set("comfort.warmth", x)} label="Warmth" />
      </div>
      <div className={cn(!active && "opacity-60")}>
        <div className="mb-1.5 flex justify-between text-[12px] font-medium text-subtle"><span>Dim screen</span><span className="tabular-nums">{v["comfort.dim"]}%</span></div>
        <Slider value={v["comfort.dim"]} min={0} max={60} step={5} onChange={(x) => set("comfort.dim", x)} label="Dim screen" />
      </div>
      <div>
        <div className="mb-2 text-[12px] font-medium text-subtle">Turn on automatically</div>
        <SegmentedControl size="sm" value={v["comfort.schedule"]} onChange={(x) => set("comfort.schedule", x)} options={[{ value: "manual", label: "Off" }, { value: "scheduled", label: "On a schedule" }]} />
        {v["comfort.schedule"] === "scheduled" && (
          <div className="mt-2.5 flex items-center gap-2 text-[13px] text-muted">
            From
            <input type="time" value={v["comfort.from"]} onChange={(e) => e.target.value && set("comfort.from", e.target.value)} className="h-7 rounded-md border border-border bg-surface px-2 text-fg" />
            to
            <input type="time" value={v["comfort.to"]} onChange={(e) => e.target.value && set("comfort.to", e.target.value)} className="h-7 rounded-md border border-border bg-surface px-2 text-fg" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Toolbar button: click opens quick controls; icon shows whether the filter is active. */
export function EyeComfortToggle() {
  const { active } = useEyeComfortActive();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Eye comfort" title="Eye comfort (Ctrl+Shift+E)" className={cn(active && "text-warning")}>
          {active ? <Eye /> : <EyeOff />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-4">
        <EyeComfortControls compact />
      </PopoverContent>
    </Popover>
  );
}
