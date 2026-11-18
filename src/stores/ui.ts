import { create } from "zustand";

export interface BackgroundTask {
  id: string;
  label: string;
  detail?: string;
  progress: number | null; // 0..1, null = indeterminate
  status: "running" | "done" | "error";
  updatedAt: number;
}

interface UIState {
  sidebarCollapsed: boolean;
  searchOpen: boolean;
  tasks: Record<string, BackgroundTask>;
  breadcrumbs: { label: string; to?: string }[];
  toggleSidebar: () => void;
  setSearchOpen: (open: boolean) => void;
  upsertTask: (t: Omit<BackgroundTask, "updatedAt">) => void;
  removeTask: (id: string) => void;
  setBreadcrumbs: (b: { label: string; to?: string }[]) => void;
}

const readCollapsed = () => {
  try {
    return localStorage.getItem("bookshelf.sidebarCollapsed") === "1";
  } catch {
    return false;
  }
};

export const useUI = create<UIState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  searchOpen: false,
  tasks: {},
  breadcrumbs: [],
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    try {
      localStorage.setItem("bookshelf.sidebarCollapsed", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ sidebarCollapsed: v });
  },
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  upsertTask: (t) => set({ tasks: { ...get().tasks, [t.id]: { ...t, updatedAt: Date.now() } } }),
  removeTask: (id) => {
    const { [id]: _removed, ...rest } = get().tasks;
    set({ tasks: rest });
  },
  setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),
}));
