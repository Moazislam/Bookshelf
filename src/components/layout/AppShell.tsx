import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Upload } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { SearchPalette } from "@/components/search/SearchPalette";
import { useShortcut } from "@/hooks";
import { useUI } from "@/stores/ui";
import { useSettings } from "@/stores/settings";
import { importPaths, pickAndImportFiles } from "@/features/documents/importer";
import { isMobile, isTauri } from "@/services/api";

/** Window-level drag & drop. Tauri gives us real filesystem paths. */
function useFileDrop() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!isTauri() || isMobile()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          if (p.paths.length) void importPaths(p.paths);
        }
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);
  return dragging;
}

export function GlobalShortcuts() {
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const settings = useSettings();
  useShortcut("search", () => setSearchOpen(true), { allowInInputs: true });
  useShortcut("import", () => void pickAndImportFiles());
  useShortcut("toggleSidebar", toggleSidebar);
  useShortcut("toggleTheme", () => {
    const dark = document.documentElement.classList.contains("dark");
    settings.set("appearance.theme", dark ? "light" : "dark");
  });
  return null;
}

export function AppShell() {
  const dragging = useFileDrop();
  const navigate = useNavigate();
  const location = useLocation();
  const navOpen = useUI((s) => s.mobileNavOpen);
  const setNavOpen = useUI((s) => s.setMobileNavOpen);
  useEffect(() => setNavOpen(false), [location.pathname, setNavOpen]);
  useEffect(() => {
    // Allow the reader's "back" to land somewhere sensible on first launch.
    const onNav = (e: Event) => navigate((e as CustomEvent<string>).detail);
    window.addEventListener("bookshelf:navigate", onNav);
    return () => window.removeEventListener("bookshelf:navigate", onNav);
  }, [navigate]);

  return (
    <div className="flex h-full">
      {/* Desktop and tablets: the usual sidebar. Phones: bottom tabs plus a slide-in drawer. */}
      <div className="hidden h-full md:flex">
        <Sidebar />
      </div>
      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-lg animate-slide-in-left">
            <Sidebar drawer />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto" id="main-scroll">
          <Outlet />
        </main>
        <BottomNav />
      </div>
      <SearchPalette />
      <GlobalShortcuts />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-bg/70 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/60 bg-surface px-16 py-12 shadow-lg">
            <div className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
              <Upload className="size-5" />
            </div>
            <p className="font-serif text-lg font-medium">Drop to add to your library</p>
            <p className="text-[13px] text-muted">PDF, EPUB, CBZ, TXT and Markdown — files or whole folders</p>
          </div>
        </div>
      )}
    </div>
  );
}
