import { Link } from "react-router-dom";
import { ChevronRight, CircleCheck, CircleExclamationPoint, FolderPlus, LoaderCircle, Monitor, Moon, PanelLeft, Plus, Search, Sun, Upload } from "lucide-react";
import { useUI } from "@/stores/ui";
import { useSettings, type ThemeMode } from "@/stores/settings";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
} from "@/components/ui";
import { pickAndImportFiles, pickAndImportFolder } from "@/features/documents/importer";
import { cn, relativeTime } from "@/utils";
import { isMobile } from "@/services/api";
import { EyeComfortToggle } from "./EyeComfort";

function TaskIndicator() {
  const tasks = Object.values(useUI((s) => s.tasks)).sort((a, b) => b.updatedAt - a.updatedAt);
  const removeTask = useUI((s) => s.removeTask);
  const running = tasks.filter((t) => t.status === "running");
  const errors = tasks.filter((t) => t.status === "error");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Background tasks" className="relative">
          {running.length ? (
            <LoaderCircle className="animate-spin text-accent" />
          ) : errors.length ? (
            <CircleExclamationPoint className="text-danger" />
          ) : (
            <CircleCheck />
          )}
          {running.length > 0 && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3.5 py-2.5 text-[12px] font-medium text-subtle">Activity</div>
        {tasks.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[13px] text-muted">No background tasks. Imports and indexing show up here.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {tasks.map((t) => (
              <li key={t.id} className="px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  {t.status === "running" ? <LoaderCircle className="size-3.5 animate-spin text-accent" /> : t.status === "error" ? <CircleExclamationPoint className="size-3.5 text-danger" /> : <CircleCheck className="size-3.5 text-success" />}
                  <span className="truncate text-[13px] font-medium">{t.label}</span>
                  {t.status !== "running" && (
                    <button className="ml-auto text-[11px] text-subtle hover:text-fg" onClick={() => removeTask(t.id)}>
                      Dismiss
                    </button>
                  )}
                </div>
                {t.detail && <p className="mt-0.5 truncate pl-5.5 text-[12px] text-muted">{t.detail}</p>}
                {t.status === "running" && t.progress !== null && <Progress value={t.progress} className="mt-2 ml-5.5 w-auto" />}
                {t.status !== "running" && <p className="pl-5.5 text-[11px] text-subtle">{relativeTime(t.updatedAt)}</p>}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

const THEME_ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

export function ThemeToggle() {
  const theme = useSettings((s) => s.values["appearance.theme"]);
  const set = useSettings((s) => s.set);
  const Icon = THEME_ICON[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-40">
        {(["light", "dark", "system"] as ThemeMode[]).map((m) => {
          const I = THEME_ICON[m];
          return (
            <DropdownMenuItem key={m} onSelect={() => set("appearance.theme", m)} className={cn(theme === m && "text-accent [&_svg]:text-accent")}>
              <I /> {m[0].toUpperCase() + m.slice(1)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const setNavOpen = useUI((s) => s.setMobileNavOpen);
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const crumbs = useUI((s) => s.breadcrumbs);
  // Below the md breakpoint the sidebar is a drawer rather than a column.
  const onToggle = () => (window.matchMedia("(max-width: 767px)").matches ? setNavOpen(true) : toggleSidebar());
  return (
    <header className="shrink-0 border-b border-border bg-bg/80 pt-safe-t backdrop-blur">
     <div className="flex h-13 items-center gap-2 px-3">
      <IconButton label="Toggle sidebar" shortcut="Ctrl+B" onClick={onToggle}>
        <PanelLeft />
      </IconButton>
      <nav className="hidden min-w-0 items-center gap-1 text-[13px] sm:flex" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-subtle" />}
            {c.to && i < crumbs.length - 1 ? (
              <Link to={c.to} className="truncate text-muted hover:text-fg">
                {c.label}
              </Link>
            ) : (
              <span className={cn("truncate", i === crumbs.length - 1 ? "font-medium text-fg" : "text-muted")}>{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      <button
        onClick={() => setSearchOpen(true)}
        className="mx-auto flex h-8.5 w-full min-w-0 max-w-[420px] flex-1 items-center sm:flex-none gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-subtle shadow-sm transition-colors hover:border-border-strong"
      >
        <Search className="size-4" />
        <span className="truncate">Search documents, notes, highlights…</span>
        <span className="ml-auto hidden gap-0.5 md:flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Quick add">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52">
            <DropdownMenuItem onSelect={() => pickAndImportFiles()}>
              <Upload /> Import files…
            </DropdownMenuItem>
            {!isMobile() && (
              <DropdownMenuItem onSelect={() => pickAndImportFolder()}>
                <FolderPlus /> Import a folder…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link to="/notes?new=1">
                <Plus /> New note
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TaskIndicator />
        <span className="hidden sm:contents">
          <EyeComfortToggle />
          <ThemeToggle />
        </span>
      </div>
     </div>
    </header>
  );
}
