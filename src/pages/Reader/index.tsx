import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  PanelLeft,
  PanelRight,
  Search,
  Type,
  ZoomIn,
  ZoomOut,
  Columns2,
  Rows3,
  Moon,
} from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, isMobile, isTauri } from "@/services/api";
import { useLibrary } from "@/stores/library";
import { useSettings } from "@/stores/settings";
import { useReader } from "@/features/reading/store";
import { useReadingSession } from "@/features/reading/session";
import { LeftPanel, RightPanel, SidePanel, type LeftTab, type RightTab } from "@/features/reading/ReaderPanels";
import { HighlightPopover, SelectionPopover } from "@/features/reading/AnnotationPopovers";
import { PdfEngine, type ZoomMode } from "@/features/reading/engines/PdfEngine";
import { EpubEngine } from "@/features/reading/engines/EpubEngine";
import { TextEngine } from "@/features/reading/engines/TextEngine";
import { ComicEngine } from "@/features/reading/engines/ComicEngine";
import { EngineError, EngineLoading } from "@/features/reading/engines/common";
import { Button, EmptyState, IconButton, Popover, PopoverContent, PopoverTrigger, SegmentedControl, Slider, Select, Switch, Tooltip } from "@/components/ui";
import { ThemeToggle } from "@/components/layout/TopBar";
import { EyeComfortToggle } from "@/components/layout/EyeComfort";
import { relinkDocument } from "@/features/documents/actions";
import { useShortcut } from "@/hooks";
import { cn, debounce, isTypingTarget } from "@/utils";
import type { Document } from "@/types";

function TypographyPopover({ format }: { format: Document["format"] }) {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  if (format === "pdf") {
    return (
      <div className="w-64 space-y-4 text-[13px]">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Layout</div>
          <SegmentedControl
            value={v["reading.pdfLayout"]}
            onChange={(x) => set("reading.pdfLayout", x)}
            options={[
              { value: "continuous", label: <><Rows3 /> Continuous</> },
              { value: "single", label: <><Columns2 /> Single page</> },
            ]}
          />
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Moon className="size-3.5 text-muted" /> Dark pages in dark mode</span>
          <Switch checked={v["reading.pdfDarkInvert"]} onChange={(x) => set("reading.pdfDarkInvert", x)} label="Invert pages in dark mode" />
        </label>
      </div>
    );
  }
  if (format === "cbz") {
    return (
      <div className="w-64 space-y-4 text-[13px]">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Fit</div>
          <SegmentedControl value={v["reading.comicFit"]} onChange={(x) => set("reading.comicFit", x)} options={[{ value: "height", label: "Height" }, { value: "width", label: "Width" }, { value: "both", label: "Page" }]} />
        </div>
        <label className="flex items-center justify-between">
          Two-page spread
          <Switch checked={v["reading.comicSpread"]} onChange={(x) => set("reading.comicSpread", x)} label="Two-page spread" />
        </label>
      </div>
    );
  }
  return (
    <div className="w-72 space-y-4 text-[13px]">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Theme</div>
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["auto", "Auto", "linear-gradient(135deg,#fffdf9 50%,#18181b 50%)", "#555"],
              ["light", "Light", "#fffdf9", "#24211d"],
              ["sepia", "Sepia", "#f4ecd8", "#4a3b28"],
              ["dark", "Dark", "#18181b", "#dedbd4"],
            ] as const
          ).map(([k, label, bg, fg]) => (
            <button key={k} onClick={() => set("reading.theme", k)} className={cn("flex h-12 flex-col items-center justify-center rounded-md border text-[11px] font-medium", v["reading.theme"] === k ? "border-accent ring-2 ring-accent/30" : "border-border")} style={{ background: bg, color: fg }}>
              <span className="font-serif text-[15px]">Aa</span>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Font</span>
        <Select value={v["reading.font"]} onChange={(e) => set("reading.font", e.target.value as typeof v["reading.font"])} className="h-8">
          <option value="literata">Literata</option>
          <option value="serif">Source Serif</option>
          <option value="sans">Inter (sans-serif)</option>
          {format === "epub" && <option value="publisher">Publisher default</option>}
        </Select>
      </label>
      <div>
        <div className="mb-1.5 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-subtle"><span>Size</span><span className="tabular-nums">{v["reading.fontSize"]}%</span></div>
        <Slider value={v["reading.fontSize"]} min={70} max={200} step={5} onChange={(x) => set("reading.fontSize", x)} label="Font size" />
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-subtle"><span>Line spacing</span><span className="tabular-nums">{v["reading.lineHeight"].toFixed(2)}</span></div>
        <Slider value={v["reading.lineHeight"]} min={1.2} max={2.4} step={0.05} onChange={(x) => set("reading.lineHeight", x)} label="Line spacing" />
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-subtle"><span>Margins</span></div>
        <Slider value={v["reading.margins"]} min={0} max={4} step={1} onChange={(x) => set("reading.margins", x)} label="Margins" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl size="sm" value={v["reading.align"]} onChange={(x) => set("reading.align", x)} options={[{ value: "left", label: "Left" }, { value: "justify", label: "Justify" }]} />
        {format === "epub" && (
          <SegmentedControl size="sm" value={v["reading.epubFlow"]} onChange={(x) => set("reading.epubFlow", x)} options={[{ value: "paginated", label: "Pages" }, { value: "scrolled", label: "Scroll" }]} />
        )}
      </div>
    </div>
  );
}

function PdfZoomControls() {
  const engine = useReader((s) => s.engine);
  const [state, setState] = useState<{ zoom: ZoomMode; percent: number }>({ zoom: "fit-width", percent: 100 });
  useEffect(() => {
    const on = (e: Event) => setState((e as CustomEvent).detail);
    window.addEventListener("bookshelf:pdf-zoom", on);
    return () => window.removeEventListener("bookshelf:pdf-zoom", on);
  }, []);
  const setZoom = (z: ZoomMode) => window.dispatchEvent(new CustomEvent("bookshelf:set-pdf-zoom", { detail: z }));
  return (
    <div className="flex items-center gap-0.5">
      <IconButton label="Zoom out" shortcut="Ctrl+-" onClick={() => engine?.zoom?.(-1)}><ZoomOut /></IconButton>
      <Select
        value={typeof state.zoom === "number" ? "custom" : state.zoom}
        onChange={(e) => {
          const v = e.target.value;
          setZoom(v === "fit-width" || v === "fit-page" ? v : Number(v));
        }}
        className="h-7 w-[104px] px-2 text-[12px]"
        aria-label="Zoom"
      >
        <option value="fit-width">Fit width</option>
        <option value="fit-page">Fit page</option>
        {typeof state.zoom === "number" && <option value="custom">{state.percent}%</option>}
        {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
      </Select>
      <IconButton label="Zoom in" shortcut="Ctrl+=" onClick={() => engine?.zoom?.(1)}><ZoomIn /></IconButton>
    </div>
  );
}

export function ReaderPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fromStore = useLibrary((s) => (id ? s.byId[id] : undefined));
  const loaded = useLibrary((s) => s.loaded);
  const reset = useReader((s) => s.reset);
  const set = useReader((s) => s.set);
  const engine = useReader((s) => s.engine);
  const location = useReader((s) => s.location);
  const bookmarks = useReader((s) => s.bookmarks);

  const [doc, setDoc] = useState<Document | null>(null);
  const [initial, setInitial] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(() => localStorage.getItem("bookshelf.reader.left") !== "0");
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem("bookshelf.reader.right") === "1");
  const [leftTab, setLeftTab] = useState<LeftTab>("contents");
  const [rightTab, setRightTab] = useState<RightTab>("highlights");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("bookshelf.reader.left", leftOpen ? "1" : "0");
      localStorage.setItem("bookshelf.reader.right", rightOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [leftOpen, rightOpen]);

  // Load document, annotations and the starting location.
  useEffect(() => {
    if (!id || !loaded) return;
    let alive = true;
    setInitial(undefined);
    setError(null);
    (async () => {
      const d = fromStore ?? (await api.getDocument(id));
      if (!alive) return;
      if (d.missing) {
        setDoc(d);
        return;
      }
      reset(d);
      setDoc(d);
      const [highlights, bm, pos] = await Promise.all([api.listHighlights(d.id), api.listBookmarks(d.id), api.getReadingPosition(d.id)]);
      if (!alive) return;
      set({ highlights, bookmarks: bm });
      const hlId = params.get("hl");
      const hl = hlId ? highlights.find((h) => h.id === hlId) : undefined;
      const q = params.get("q");
      if (q) set({ findQuery: q });
      if (q) setLeftTab("search");
      setInitial(params.get("loc") ?? (hl ? hl.locator : null) ?? pos?.locator ?? null);
      if (hl) setTimeout(() => useReader.getState().engine?.goToHighlight(hl), 900);
      await api.markDocumentOpened(d.id);
      const fresh = await api.getDocument(d.id);
      useLibrary.getState().upsertDocuments([fresh]);
    })().catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loaded]);

  useEffect(() => () => reset(null), [reset]);
  useReadingSession(doc && !doc.missing ? doc.id : undefined);

  // Persist position (debounced) and keep progress in the library store fresh.
  const save = useRef(
    debounce((docId: string, locator: string, progress: number) => {
      api.saveReadingPosition(docId, locator, progress).catch(() => {});
      const cur = useLibrary.getState().byId[docId];
      if (cur) useLibrary.getState().upsertDocuments([{ ...cur, progress, openedAt: Date.now() }]);
    }, 800),
  );
  useEffect(() => {
    if (doc && location && initial !== undefined) save.current(doc.id, location.locator, location.progress);
  }, [doc, location, initial]);
  useEffect(() => {
    const flushOnExit = () => {
      const loc = useReader.getState().location;
      const d = useReader.getState().doc;
      if (d && loc) void api.saveReadingPosition(d.id, loc.locator, loc.progress);
    };
    window.addEventListener("beforeunload", flushOnExit);
    return () => {
      window.removeEventListener("beforeunload", flushOnExit);
      flushOnExit();
      useLibrary.getState().refreshDocuments().catch(() => {});
    };
  }, []);

  const currentBookmark = bookmarks.find((b) => {
    const t = engine?.bookmarkTarget();
    return t && b.locator === t.locator;
  });

  const toggleBookmark = useCallback(async () => {
    if (!doc || !engine) return;
    const t = engine.bookmarkTarget();
    if (!t) return;
    const existing = useReader.getState().bookmarks.find((b) => b.locator === t.locator);
    try {
      if (existing) {
        await api.deleteBookmark(existing.id);
        set({ bookmarks: useReader.getState().bookmarks.filter((b) => b.id !== existing.id) });
        toast("Bookmark removed");
      } else {
        const b = await api.createBookmark({ documentId: doc.id, locator: t.locator, label: t.label, sortKey: t.sortKey });
        set({ bookmarks: [...useReader.getState().bookmarks, b].sort((a, c) => a.sortKey - c.sortKey) });
        toast.success("Bookmarked", { description: t.label });
      }
    } catch (e) {
      toast.error("Could not update bookmark", { description: errorMessage(e) });
    }
  }, [doc, engine, set]);

  const toggleFullscreen = useCallback(async () => {
    const next = !fullscreen;
    setFullscreen(next);
    setChromeHidden(next);
    if (isMobile()) return; // the app is already full-screen; hiding the reader chrome is enough
    if (isTauri()) await getCurrentWindow().setFullscreen(next).catch(() => {});
    else if (next) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [fullscreen]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const eng = useReader.getState().engine;
      if (!eng) return;
      if (["ArrowRight", "PageDown"].includes(e.key) || (e.key === " " && !e.shiftKey && doc?.format !== "pdf" && doc?.format !== "txt" && doc?.format !== "md")) {
        if (doc?.format === "pdf" && e.key === "ArrowRight" && useSettings.getState().values["reading.pdfLayout"] === "continuous") return;
        e.preventDefault();
        eng.next();
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        if (doc?.format === "pdf" && e.key === "ArrowLeft" && useSettings.getState().values["reading.pdfLayout"] === "continuous") return;
        e.preventDefault();
        eng.prev();
      } else if (e.key === "Escape") {
        const st = useReader.getState();
        if (st.selection || st.activeHighlight) set({ selection: null, activeHighlight: null });
        else if (fullscreen) void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc?.format, fullscreen, toggleFullscreen, set]);

  useShortcut("readerLeftPanel", () => setLeftOpen((v) => !v), { allowInInputs: true });
  useShortcut("readerRightPanel", () => setRightOpen((v) => !v), { allowInInputs: true });
  useShortcut("readerBookmark", () => void toggleBookmark(), { allowInInputs: true });
  useShortcut("readerFullscreen", () => void toggleFullscreen(), { allowInInputs: true });
  useShortcut("zoomIn", () => engine?.zoom?.(1), { allowInInputs: true });
  useShortcut("zoomOut", () => engine?.zoom?.(-1), { allowInInputs: true });
  useShortcut(
    "readerFind",
    () => {
      setLeftOpen(true);
      setLeftTab("search");
      setTimeout(() => window.dispatchEvent(new Event("bookshelf:focus-find")), 50);
    },
    { allowInInputs: true },
  );

  const addNoteForHighlight = async (highlightId: string) => {
    if (!doc) return;
    const h = useReader.getState().highlights.find((x) => x.id === highlightId);
    try {
      const n = await api.createNote({ documentId: doc.id, highlightId, title: h ? h.text.slice(0, 60) : "", body: h ? `> ${h.text.replace(/\n+/g, " ")}\n\n` : "" });
      set({ activeHighlight: null });
      setRightOpen(true);
      setRightTab("notes");
      setOpenNoteId(n.id);
    } catch (e) {
      toast.error("Could not create note", { description: errorMessage(e) });
    }
  };

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/library"));

  if (error) return <div className="h-full"><EngineError message={error} /></div>;
  if (!doc || (initial === undefined && !doc.missing)) return <div className="h-full bg-bg"><EngineLoading /></div>;
  if (doc.missing) {
    return (
      <div className="grid h-full place-items-center bg-bg">
        <EmptyState
          icon={Bookmark}
          title="File not found"
          description={<>BookShelf can't find <span className="font-medium">{doc.fileName}</span> at its saved location. Your highlights and notes are safe — locate the file to continue.</>}
          action={
            <div className="flex gap-2">
              <Button onClick={back}>Go back</Button>
              <Button variant="primary" onClick={async () => { await relinkDocument(doc); const d = await api.getDocument(doc.id); if (!d.missing) navigate(0); }}>Locate file…</Button>
            </div>
          }
        />
      </div>
    );
  }

  const Engine = { pdf: PdfEngine, epub: EpubEngine, txt: TextEngine, md: TextEngine, cbz: ComicEngine }[doc.format];
  const progress = location?.progress ?? doc.progress;

  return (
    <div className="flex h-full flex-col bg-bg" onMouseMove={(e) => fullscreen && setChromeHidden(e.clientY > 70)}>
      <header className={cn("z-20 flex min-h-12 shrink-0 items-center gap-1 border-b border-border bg-bg px-2 pt-safe-t transition-all", fullscreen && "absolute inset-x-0 top-0 shadow-md", fullscreen && chromeHidden && "pointer-events-none -translate-y-full opacity-0")}>
        <IconButton label="Back" onClick={back}><ArrowLeft /></IconButton>
        <IconButton label="Contents & bookmarks" shortcut="Ctrl+[" active={leftOpen} onClick={() => setLeftOpen(!leftOpen)}><PanelLeft /></IconButton>
        <div className="mx-2 min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{doc.title}</div>
          <div className="truncate text-[11.5px] text-muted">{[doc.author, location?.label].filter(Boolean).join(" · ")}</div>
        </div>
        {doc.format === "pdf" && <PdfZoomControls />}
        {/* On phones, page turns are tap zones and find lives in the Contents panel. */}
        <span className="hidden md:contents">
          <div className="mx-1 h-5 w-px bg-border" />
          <IconButton label="Previous" onClick={() => engine?.prev()}><ChevronLeft /></IconButton>
          <IconButton label="Next" onClick={() => engine?.next()}><ChevronRight /></IconButton>
          <IconButton label="Find in document" shortcut="Ctrl+F" onClick={() => { setLeftOpen(true); setLeftTab("search"); }}><Search /></IconButton>
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Display settings"><Type /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="p-4">
            <TypographyPopover format={doc.format} />
          </PopoverContent>
        </Popover>
        <IconButton label={currentBookmark ? "Remove bookmark" : "Bookmark this page"} shortcut="Ctrl+D" onClick={toggleBookmark} active={!!currentBookmark}>
          {currentBookmark ? <BookmarkCheck className="text-accent" /> : <Bookmark />}
        </IconButton>
        <span className="hidden md:contents">
          <EyeComfortToggle />
          <ThemeToggle />
          <IconButton label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F11" onClick={toggleFullscreen}>{fullscreen ? <Minimize /> : <Maximize />}</IconButton>
        </span>
        <IconButton label="Highlights, notes & info" shortcut="Ctrl+]" active={rightOpen} onClick={() => setRightOpen(!rightOpen)}><PanelRight /></IconButton>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <SidePanel side="left" open={leftOpen && !fullscreen} storageKey="bookshelf.reader.leftWidth">
          <LeftPanel tab={leftTab} setTab={setLeftTab} />
        </SidePanel>
        <main className="relative min-w-0 flex-1">
          <Engine key={doc.id} doc={doc} initial={initial ?? null} />
          {(doc.format === "epub" || doc.format === "cbz") && (
            // Phones: tap the outer edges to turn pages. Narrow strips, so text in the middle stays selectable.
            <>
              <button aria-label="Previous page" className="absolute inset-y-0 left-0 z-10 w-[14%] md:hidden" onClick={() => engine?.prev()} />
              <button aria-label="Next page" className="absolute inset-y-0 right-0 z-10 w-[14%] md:hidden" onClick={() => engine?.next()} />
            </>
          )}
        </main>
        <SidePanel side="right" open={rightOpen && !fullscreen} storageKey="bookshelf.reader.rightWidth">
          <RightPanel tab={rightTab} setTab={setRightTab} openNoteId={openNoteId} setOpenNoteId={setOpenNoteId} />
        </SidePanel>
      </div>

      <footer className={cn("flex min-h-7 shrink-0 items-center gap-3 border-t border-border bg-bg px-4 pb-safe-b text-[11px] tabular-nums text-subtle", fullscreen && "hidden")}>
        <span>{location?.page && location.total && doc.format !== "epub" ? `${location.page} / ${location.total}` : location?.label}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border/70">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
        </div>
        <Tooltip content="Overall progress" side="top"><span>{Math.round(progress * 100)}%</span></Tooltip>
      </footer>

      <SelectionPopover />
      <HighlightPopover onAddNote={addNoteForHighlight} />
    </div>
  );
}
