import { NavLink } from "react-router-dom";
import { BookOpen, Highlighter, LayoutDashboard, Library, Menu } from "lucide-react";
import { useUI } from "@/stores/ui";
import { cn } from "@/utils";

const TABS = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/library", label: "Library", icon: Library },
  { to: "/reading", label: "Reading", icon: BookOpen },
  { to: "/notes", label: "Notes", icon: Highlighter },
];

/** Phone-only tab bar for the main destinations; "More" opens the full sidebar as a drawer. */
export function BottomNav() {
  const setNavOpen = useUI((s) => s.setMobileNavOpen);
  const item = "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium";
  return (
    <nav className="flex shrink-0 border-t border-border bg-bg/95 pb-safe-b backdrop-blur md:hidden" aria-label="Main">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cn(item, isActive ? "text-accent" : "text-muted")}>
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
      <button className={cn(item, "text-muted")} onClick={() => setNavOpen(true)} aria-label="More">
        <Menu className="size-5" />
        More
      </button>
    </nav>
  );
}
