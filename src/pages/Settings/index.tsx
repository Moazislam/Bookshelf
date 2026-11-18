import { useEffect, useState } from "react";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { Archive, BookOpen, Check, Database, FolderOpen, Keyboard, Library, Palette, RefreshCw, RotateCcw, Upload, Download, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/services/api";
import { useBreadcrumbs, useAsync, formatShortcut } from "@/hooks";
import { useSettings, DEFAULT_SHORTCUTS, DARK_PALETTES, LIGHT_PALETTES, type Accent, type Settings } from "@/stores/settings";
import { EyeComfortControls } from "@/components/layout/EyeComfort";
import { refreshLibrary, useLibrary } from "@/stores/library";
import { enqueuePdfProcessing } from "@/services/pdfProcessing";
import { Button, Input, Kbd, SegmentedControl, Select, Slider, Spinner, Switch } from "@/components/ui";
import { highlightsToMarkdown, notesToMarkdown } from "@/features/annotations/export";
import { cn, formatBytes } from "@/utils";

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "reading", label: "Reading", icon: BookOpen },
  { id: "library", label: "Library", icon: Library },
  { id: "data", label: "Data & backup", icon: Database },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
] as const;

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-border py-4 last:border-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        {description && <div className="mt-0.5 text-[12.5px] text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 font-serif text-[19px] font-semibold">{title}</h2>
      <div className="rounded-xl border border-border bg-surface px-5 shadow-sm">{children}</div>
    </section>
  );
}

const ACCENTS: { id: Accent; color: string; label: string }[] = [
  { id: "ember", color: "#b5562f", label: "Ember" },
  { id: "ink", color: "#3b5ba9", label: "Ink" },
  { id: "moss", color: "#4a7656", label: "Moss" },
  { id: "plum", color: "#7a4e8c", label: "Plum" },
  { id: "slate", color: "#4b5563", label: "Slate" },
];

type PaletteDef = (typeof LIGHT_PALETTES)[number] | (typeof DARK_PALETTES)[number];

function PaletteCard({ p, selected, onSelect }: { p: PaletteDef; selected: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} className={cn("group flex flex-col gap-1.5 text-left", selected ? "text-fg" : "text-muted hover:text-fg")} aria-pressed={selected}>
      <span className={cn("relative block h-[68px] w-[104px] overflow-hidden rounded-lg border-2 transition", selected ? "border-accent" : "border-border group-hover:border-border-strong")} style={{ background: p.bg }}>
        <span className="absolute inset-y-0 left-0 w-6" style={{ background: p.surface, borderRight: `1px solid ${p.border}` }} />
        <span className="absolute left-8 right-2.5 top-2.5 h-9 rounded-md" style={{ background: p.surface, border: `1px solid ${p.border}` }} />
        <span className="absolute left-10 top-4 h-1.5 w-10 rounded-full" style={{ background: p.fg }} />
        <span className="absolute left-10 top-7 h-1 w-14 rounded-full opacity-50" style={{ background: p.fg }} />
        <span className="absolute bottom-2 left-8 h-2 w-8 rounded-full bg-accent" />
        {selected && <span className="absolute right-1.5 bottom-1.5 grid size-4 place-items-center rounded-full bg-accent"><Check className="size-2.5 text-accent-fg" /></span>}
      </span>
      <span className="text-[12px] font-medium">{p.label}</span>
    </button>
  );
}

function Appearance() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const [name, setName] = useState(v["profile.name"]);
  return (
    <Group title="Appearance">
      <Row label="Theme" description="Follow your system or pick one.">
        <SegmentedControl value={v["appearance.theme"]} onChange={(x) => set("appearance.theme", x)} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
      </Row>
      <div className="border-b border-border py-4">
        <div className="text-[13.5px] font-medium">Light theme</div>
        <div className="mt-0.5 text-[12.5px] text-muted">Used in Light mode, and in System mode during the day.</div>
        <div className="mt-3 flex flex-wrap gap-4">
          {LIGHT_PALETTES.map((p) => <PaletteCard key={p.id} p={p} selected={v["appearance.lightPalette"] === p.id} onSelect={() => set("appearance.lightPalette", p.id)} />)}
        </div>
      </div>
      <div className="border-b border-border py-4">
        <div className="text-[13.5px] font-medium">Dark theme</div>
        <div className="mt-0.5 text-[12.5px] text-muted">Used in Dark mode, and in System mode at night.</div>
        <div className="mt-3 flex flex-wrap gap-4">
          {DARK_PALETTES.map((p) => <PaletteCard key={p.id} p={p} selected={v["appearance.darkPalette"] === p.id} onSelect={() => set("appearance.darkPalette", p.id)} />)}
        </div>
      </div>
      <Row label="Accent colour">
        <div className="flex gap-2">
          {ACCENTS.map((a) => (
            <button key={a.id} title={a.label} aria-label={a.label} onClick={() => set("appearance.accent", a.id)} className={cn("grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-surface", v["appearance.accent"] === a.id && "ring-2 ring-fg/40")} style={{ background: a.color }}>
              {v["appearance.accent"] === a.id && <Check className="size-3.5 text-white" />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Interface density">
        <SegmentedControl value={v["appearance.density"]} onChange={(x) => set("appearance.density", x)} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
      </Row>
      <Row label="Interface font">
        <SegmentedControl value={v["appearance.uiFont"]} onChange={(x) => set("appearance.uiFont", x)} options={[{ value: "inter", label: "Inter" }, { value: "system", label: "System" }]} />
      </Row>
      <Row label="Your name" description="Used for the dashboard greeting. Stays on this computer.">
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => set("profile.name", name.trim())} placeholder="Optional" className="w-52" />
      </Row>
    </Group>
  );
}

function Reading() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  return (
    <>
      <Group title="PDF">
        <Row label="Default zoom">
          <Select value={String(v["reading.pdfZoom"])} onChange={(e) => set("reading.pdfZoom", e.target.value === "fit-width" || e.target.value === "fit-page" ? e.target.value : Number(e.target.value))} className="w-40">
            <option value="fit-width">Fit width</option>
            <option value="fit-page">Fit page</option>
            {[0.75, 1, 1.25, 1.5, 2].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
          </Select>
        </Row>
        <Row label="Page layout">
          <SegmentedControl value={v["reading.pdfLayout"]} onChange={(x) => set("reading.pdfLayout", x)} options={[{ value: "continuous", label: "Continuous" }, { value: "single", label: "Single page" }]} />
        </Row>
        <Row label="Dark pages in dark mode" description="Inverts page colours for comfortable night reading.">
          <Switch checked={v["reading.pdfDarkInvert"]} onChange={(x) => set("reading.pdfDarkInvert", x)} label="Dark pages" />
        </Row>
      </Group>
      <Group title="EPUB & text">
        <Row label="Reading theme">
          <SegmentedControl value={v["reading.theme"]} onChange={(x) => set("reading.theme", x)} options={[{ value: "auto", label: "Auto" }, { value: "light", label: "Light" }, { value: "sepia", label: "Sepia" }, { value: "dark", label: "Dark" }]} />
        </Row>
        <Row label="Font">
          <Select value={v["reading.font"]} onChange={(e) => set("reading.font", e.target.value as Settings["reading.font"])} className="w-48">
            <option value="literata">Literata</option>
            <option value="serif">Source Serif</option>
            <option value="sans">Inter</option>
            <option value="publisher">Publisher default (EPUB)</option>
          </Select>
        </Row>
        <Row label="Font size" description={`${v["reading.fontSize"]}%`}>
          <Slider value={v["reading.fontSize"]} min={70} max={200} step={5} onChange={(x) => set("reading.fontSize", x)} className="w-48" label="Font size" />
        </Row>
        <Row label="Line spacing" description={v["reading.lineHeight"].toFixed(2)}>
          <Slider value={v["reading.lineHeight"]} min={1.2} max={2.4} step={0.05} onChange={(x) => set("reading.lineHeight", x)} className="w-48" label="Line spacing" />
        </Row>
        <Row label="Margins">
          <Slider value={v["reading.margins"]} min={0} max={4} step={1} onChange={(x) => set("reading.margins", x)} className="w-48" label="Margins" />
        </Row>
        <Row label="Text alignment">
          <SegmentedControl value={v["reading.align"]} onChange={(x) => set("reading.align", x)} options={[{ value: "left", label: "Left" }, { value: "justify", label: "Justified" }]} />
        </Row>
        <Row label="EPUB layout">
          <SegmentedControl value={v["reading.epubFlow"]} onChange={(x) => set("reading.epubFlow", x)} options={[{ value: "paginated", label: "Paginated" }, { value: "scrolled", label: "Continuous scroll" }]} />
        </Row>
      </Group>
    </>
  );
}

function LibrarySettings() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const documents = useLibrary((s) => s.documents);
  const [checking, setChecking] = useState(false);
  const pdfPending = documents.filter((d) => d.format === "pdf" && (!d.metadataReady || !d.textIndexed));
  return (
    <Group title="Library">
      <Row label="Library folder" description={v["library.folder"] ?? "Not set — documents stay where you imported them from."}>
        <div className="flex gap-2">
          {v["library.folder"] && <Button size="sm" onClick={() => set("library.folder", null)}>Clear</Button>}
          <Button
            size="sm"
            onClick={async () => {
              const dir = await open({ directory: true, title: "Choose a library folder" });
              if (typeof dir === "string") set("library.folder", dir);
            }}
          >
            <FolderOpen /> Choose…
          </Button>
        </div>
      </Row>
      <Row label="Copy files into the library folder on import" description="Keeps a managed copy; originals are never modified or moved.">
        <Switch checked={v["library.copyOnImport"]} disabled={!v["library.folder"]} onChange={(x) => set("library.copyOnImport", x)} label="Copy on import" />
      </Row>
      <Row label="Index PDF text for search" description="Extracts text in the background after import so PDFs are fully searchable.">
        <Switch checked={v["library.extractText"]} onChange={(x) => set("library.extractText", x)} label="Index PDF text" />
      </Row>
      <Row label="Duplicate handling" description="Files are identified by content. Re-importing a file you already have is skipped; if the original was moved, the document is relinked to the new location.">
        <span className="text-[12px] text-subtle">Automatic</span>
      </Row>
      <Row label="Find moved or deleted files" description="Checks every document's file is still where BookShelf expects it.">
        <Button
          size="sm"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            try {
              const missing = await api.checkMissingFiles();
              await refreshLibrary();
              toast[missing ? "warning" : "success"](missing ? `${missing} file${missing === 1 ? " is" : "s are"} missing` : "All files found", missing ? { description: "Use “Locate file…” on those documents to relink them." } : undefined);
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? <Spinner className="size-3.5" /> : <RefreshCw />} Check now
        </Button>
      </Row>
      {pdfPending.length > 0 && (
        <Row label={`${pdfPending.length} PDF${pdfPending.length === 1 ? "" : "s"} not fully processed`} description="Metadata or search text is still missing.">
          <Button size="sm" onClick={() => enqueuePdfProcessing(pdfPending.map((d) => d.id))}><RefreshCw /> Process now</Button>
        </Row>
      )}
    </Group>
  );
}

function Data() {
  const tags = useLibrary((s) => s.tags);
  const info = useAsync(() => api.libraryInfo(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error("Something went wrong", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Group title="Backup">
        <Row label="Back up library" description="Saves your database (metadata, collections, tags, highlights, notes, bookmarks, progress, history) and covers into one .zip. Document files themselves are not included.">
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              run("backup", async () => {
                const path = await save({ title: "Save backup", defaultPath: `BookShelf-backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: "Zip archive", extensions: ["zip"] }] });
                if (!path) return;
                const size = await api.createBackup(path);
                toast.success("Backup created", { description: `${path} (${formatBytes(size)})` });
              })
            }
          >
            {busy === "backup" ? <Spinner className="size-3.5" /> : <Archive />} Create backup…
          </Button>
        </Row>
        <Row label="Restore from backup" description="Replaces your current library data. A safety copy of the current database is kept next to it.">
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              run("restore", async () => {
                const path = await open({ title: "Choose a BookShelf backup", filters: [{ name: "Zip archive", extensions: ["zip"] }] });
                if (typeof path !== "string") return;
                const ok = await ask("Restoring replaces all current library data with the backup. Continue?", { title: "Restore backup", kind: "warning", okLabel: "Restore" });
                if (!ok) return;
                await api.restoreBackup(path);
                toast.success("Backup restored");
                setTimeout(() => window.location.reload(), 600);
              })
            }
          >
            {busy === "restore" ? <Spinner className="size-3.5" /> : <Upload />} Restore…
          </Button>
        </Row>
      </Group>
      <Group title="Export">
        <Row label="Export all notes" description="One Markdown file with every note.">
          <Button size="sm" disabled={!!busy} onClick={() => run("notes", async () => {
            const notes = await api.listNotes();
            const path = await save({ title: "Export notes", defaultPath: "BookShelf-notes.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
            if (!path) return;
            await api.writeExport(path, notesToMarkdown(notes, tags));
            toast.success(`Exported ${notes.length} notes`);
          })}>
            <Download /> Export…
          </Button>
        </Row>
        <Row label="Export all highlights" description="Markdown grouped by document, or JSON for other tools.">
          <div className="flex gap-2">
            <Button size="sm" disabled={!!busy} onClick={() => run("hl", async () => {
              const hl = await api.listHighlights();
              const path = await save({ title: "Export highlights", defaultPath: "BookShelf-highlights.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
              if (!path) return;
              await api.writeExport(path, highlightsToMarkdown(hl));
              toast.success(`Exported ${hl.length} highlights`);
            })}><Download /> Markdown…</Button>
            <Button size="sm" disabled={!!busy} onClick={() => run("hljson", async () => {
              const hl = await api.listHighlights();
              const path = await save({ title: "Export highlights", defaultPath: "BookShelf-highlights.json", filters: [{ name: "JSON", extensions: ["json"] }] });
              if (!path) return;
              await api.writeExport(path, JSON.stringify(hl, null, 2));
              toast.success(`Exported ${hl.length} highlights`);
            })}>JSON…</Button>
          </div>
        </Row>
      </Group>
      <Group title="Maintenance">
        <Row label="Optimise database" description="Checks integrity, compacts the database, optimises search indexes and removes unused cover images.">
          <Button size="sm" disabled={!!busy} onClick={() => run("maint", async () => {
            const r = await api.runMaintenance();
            toast.success(r.integrity === "ok" ? "Database is healthy" : `Integrity check: ${r.integrity}`, { description: `${formatBytes(r.sizeBefore)} → ${formatBytes(r.sizeAfter)} · ${r.orphanCoversRemoved} unused covers removed` });
            info.reload();
          })}>
            {busy === "maint" ? <Spinner className="size-3.5" /> : <Wrench />} Run now
          </Button>
        </Row>
        {info.data && (
          <div className="space-y-1 py-4 text-[12px] text-muted">
            <div>Data folder: <span className="selectable text-fg">{info.data.dataDir}</span></div>
            <div>Database: {formatBytes(info.data.databaseSize)} · Covers: {formatBytes(info.data.coversSize)} · Schema v{info.data.schemaVersion}</div>
          </div>
        )}
      </Group>
    </>
  );
}

const SHORTCUT_LABELS: Record<string, string> = {
  search: "Open search",
  import: "Import documents",
  toggleSidebar: "Toggle sidebar",
  toggleTheme: "Toggle light / dark",
  toggleEyeComfort: "Toggle eye comfort",
  readerLeftPanel: "Reader: contents panel",
  readerRightPanel: "Reader: highlights panel",
  readerFind: "Reader: find in document",
  readerBookmark: "Reader: bookmark page",
  readerFullscreen: "Reader: full screen",
  zoomIn: "Reader: zoom in",
  zoomOut: "Reader: zoom out",
};

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const parts = [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : ""].filter(Boolean);
      const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      onChange([...parts, key].join("+"));
      setRecording(false);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [recording, onChange]);
  return (
    <button onClick={() => setRecording(true)} className={cn("flex h-8 min-w-36 items-center justify-center gap-1 rounded-md border px-3 text-[12px]", recording ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface-2 hover:border-border-strong")}>
      {recording ? "Press keys… (Esc to cancel)" : formatShortcut(value).split("+").map((k, i) => <Kbd key={i}>{k}</Kbd>)}
    </button>
  );
}

function Shortcuts() {
  const shortcuts = useSettings((s) => s.values.shortcuts);
  const set = useSettings((s) => s.set);
  return (
    <Group title="Keyboard shortcuts">
      {Object.keys(DEFAULT_SHORTCUTS).map((k) => (
        <Row key={k} label={SHORTCUT_LABELS[k] ?? k}>
          <ShortcutRecorder value={shortcuts[k] ?? DEFAULT_SHORTCUTS[k]} onChange={(v) => set("shortcuts", { ...shortcuts, [k]: v })} />
        </Row>
      ))}
      <div className="flex items-center justify-between py-4 text-[12.5px] text-muted">
        <span>In the reader, ← → / Page Up / Page Down turn pages and Esc closes popups.</span>
        <Button size="sm" variant="ghost" onClick={() => set("shortcuts", DEFAULT_SHORTCUTS)}><RotateCcw /> Reset to defaults</Button>
      </div>
    </Group>
  );
}

export function SettingsPage() {
  useBreadcrumbs([{ label: "Settings" }]);
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("appearance");
  return (
    <div className="mx-auto flex max-w-5xl gap-10 px-8 py-7">
      <nav className="sticky top-7 h-fit w-48 shrink-0">
        <h1 className="mb-5 font-serif text-[28px] font-semibold">Settings</h1>
        <ul className="space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button onClick={() => setSection(s.id)} className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium", section === s.id ? "bg-surface text-fg shadow-sm ring-1 ring-border" : "text-muted hover:bg-bg-subtle hover:text-fg")}>
                <s.icon className={cn("size-4", section === s.id ? "text-accent" : "text-subtle")} /> {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 pt-16">
        {section === "appearance" && (
          <>
            <Appearance />
            <Group title="Eye comfort">
              <div className="py-4">
                <EyeComfortControls />
              </div>
            </Group>
          </>
        )}
        {section === "reading" && <Reading />}
        {section === "library" && <LibrarySettings />}
        {section === "data" && <Data />}
        {section === "shortcuts" && <Shortcuts />}
      </div>
    </div>
  );
}
