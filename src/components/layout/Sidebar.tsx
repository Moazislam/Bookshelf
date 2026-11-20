import { NavLink, useNavigate } from "react-router-dom";
import {
  BookOpen,
  ChartColumn,
  ChevronDown,
  Folder,
  FolderOpen,
  HardDrive,
  Highlighter,
  LayoutDashboard,
  Library,
  Plus,
  RotateCcwClock,
  Settings,
  Star,
  Upload,
  FolderPlus,
  Layers,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLibrary } from "@/stores/library";
import { useUI } from "@/stores/ui";
import { useSetting } from "@/stores/settings";
import { cn, formatBytes, swatch } from "@/utils";
import { isMobile } from "@/services/api";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip } from "@/components/ui";
import { pickAndImportFiles, pickAndImportFolder } from "@/features/documents/importer";
import { CollectionDialog } from "@/components/library/CollectionDialog";
import type { Collection } from "@/types";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/library", label: "My Library", icon: Library },
  { to: "/reading", label: "Currently Reading", icon: BookOpen },
  { to: "/favorites", label: "Favorites", icon: Star },
  { to: "/collections", label: "Collections", icon: Layers, end: true },
  { to: "/notes", label: "Notes & Highlights", icon: Highlighter },
  { to: "/history", label: "Reading History", icon: RotateCcwClock },
  { to: "/stats", label: "Statistics", icon: ChartColumn },
];

function NavItem({ to, label, icon: Icon, end, collapsed, count }: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; end?: boolean; collapsed: boolean; count?: number }) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
          isActive ? "bg-surface text-fg shadow-sm ring-1 ring-border" : "text-muted hover:bg-bg-subtle hover:text-fg",
          collapsed && "justify-center px-0",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn("size-4 shrink-0", isActive ? "text-accent" : "text-subtle group-hover:text-muted")} />
          {!collapsed && <span className="truncate">{label}</span>}
          {!collapsed && count !== undefined && count > 0 && <span className="ml-auto text-[11px] tabular-nums text-subtle">{count}</span>}
        </>
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function CollectionTree({ collections, parentId, depth }: { collections: Collection[]; parentId: string | null; depth: number }) {
  const children = collections.filter((c) => c.parentId === parentId);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!children.length) return null;
  return (
    <div className="flex flex-col gap-px">
      {children.map((c) => {
        const hasKids = collections.some((k) => k.parentId === c.id);
        const isOpen = open[c.id] ?? false;
        return (
          <div key={c.id}>
            <NavLink
              to={`/collections/${c.id}`}
              className={({ isActive }) =>
                cn(
                  "group flex h-7 items-center gap-2 rounded-md pr-2 text-[12.5px] transition-colors",
                  isActive ? "bg-surface text-fg shadow-sm ring-1 ring-border" : "text-muted hover:bg-bg-subtle hover:text-fg",
                )
              }
              style={{ paddingLeft: 10 + depth * 14 }}
            >
              {hasKids ? (
                <button
                  className="-ml-1 grid size-4 place-items-center rounded hover:bg-border/60"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen({ ...open, [c.id]: !isOpen });
                  }}
                  aria-label={isOpen ? "Collapse" : "Expand"}
                >
                  <ChevronDown className={cn("size-3 transition-transform", !isOpen && "-rotate-90")} />
                </button>
              ) : null}
              {isOpen ? <FolderOpen className="size-3.5 shrink-0" style={{ color: swatch(c.color) }} /> : <Folder className="size-3.5 shrink-0" style={{ color: swatch(c.color) }} />}
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-[10.5px] tabular-nums text-subtle opacity-0 group-hover:opacity-100">{c.documentCount}</span>
            </NavLink>
            {hasKids && isOpen && <CollectionTree collections={collections} parentId={c.id} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar({ drawer = false }: { drawer?: boolean }) {
  // As a phone drawer it is always shown expanded, with taller touch rows.
  const collapsed = useUI((s) => s.sidebarCollapsed) && !drawer;
  const documents = useLibrary((s) => s.documents);
  const collections = useLibrary((s) => s.collections);
  const profileName = useSetting("profile.name");
  const navigate = useNavigate();
  const [newCollection, setNewCollection] = useState(false);

  const counts = useMemo(() => {
    let reading = 0, favorites = 0, size = 0;
    for (const d of documents) {
      if (d.status === "reading") reading++;
      if (d.favorite) favorites++;
      size += d.fileSize;
    }
    return { reading, favorites, size, total: documents.length };
  }, [documents]);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200",
        collapsed ? "w-[60px]" : "w-[248px]",
        drawer && "w-[284px] max-w-[85vw] pt-safe-t pb-safe-b [&_nav_a]:h-10 [&_nav_a]:text-[14px]",
      )}
    >
      <div className={cn("flex h-13 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <div className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg shadow-sm">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4h4v16H5zM11 4h3v16h-3zM16.5 5.2l2.8-.7 3 14.6-2.8.7z" />
          </svg>
        </div>
        {!collapsed && <span className="font-serif text-[17px] font-semibold tracking-tight">BookShelf</span>}
      </div>

      <div className={cn("px-3 pb-3", collapsed && "px-2.5")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="primary" className={cn("w-full", collapsed && "px-0")} aria-label="Import documents">
              <Upload />
              {!collapsed && "Import Documents"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => pickAndImportFiles()}>
              <Upload /> Import files…
            </DropdownMenuItem>
            {!isMobile() && (
              <DropdownMenuItem onSelect={() => pickAndImportFolder()}>
                <FolderPlus /> Import a folder…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className={cn("flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3", collapsed && "px-2.5")} aria-label="Main">
        {NAV.map((n) => (
          <NavItem
            key={n.to}
            {...n}
            collapsed={collapsed}
            count={n.to === "/library" ? counts.total : n.to === "/reading" ? counts.reading : n.to === "/favorites" ? counts.favorites : undefined}
          />
        ))}

        {!collapsed && (
          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between px-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Collections</span>
              <Tooltip content="New collection" side="right">
                <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => setNewCollection(true)} aria-label="New collection">
                  <Plus />
                </Button>
              </Tooltip>
            </div>
            {collections.length ? (
              <CollectionTree collections={collections} parentId={null} depth={0} />
            ) : (
              <button onClick={() => setNewCollection(true)} className="w-full rounded-md px-2.5 py-1.5 text-left text-[12px] text-subtle hover:text-muted">
                Group documents into collections…
              </button>
            )}
          </div>
        )}
      </nav>

      <div className={cn("border-t border-border p-3", collapsed && "px-2.5")}>
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-serif text-[13px] font-semibold text-accent">
              {(profileName || "My").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium">{profileName ? `${profileName}'s Library` : "My Library"}</div>
              <div className="flex items-center gap-1 text-[11px] text-subtle">
                <HardDrive className="size-3" />
                {counts.total} docs · {formatBytes(counts.size)}
              </div>
            </div>
            <Tooltip content="Settings" side="top">
              <Button variant="ghost" size="icon-sm" onClick={() => navigate("/settings")} aria-label="Settings">
                <Settings />
              </Button>
            </Tooltip>
          </div>
        ) : (
          <NavItem to="/settings" label="Settings" icon={Settings} collapsed />
        )}
      </div>
      <CollectionDialog open={newCollection} onOpenChange={setNewCollection} />
    </aside>
  );
}
