import { create } from "zustand";
import { api, errorMessage } from "@/services/api";
import type { Collection, Document, Tag } from "@/types";
import { toast } from "sonner";

interface LibraryState {
  loaded: boolean;
  documents: Document[];
  byId: Record<string, Document>;
  collections: Collection[];
  tags: Tag[];
  loadAll: () => Promise<void>;
  refreshDocuments: () => Promise<void>;
  refreshCollections: () => Promise<void>;
  refreshTags: () => Promise<void>;
  upsertDocuments: (docs: Document[]) => void;
  dropDocuments: (ids: string[]) => void;
}

const index = (docs: Document[]) => Object.fromEntries(docs.map((d) => [d.id, d]));

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  documents: [],
  byId: {},
  collections: [],
  tags: [],

  loadAll: async () => {
    try {
      const [documents, collections, tags] = await Promise.all([api.listDocuments(), api.listCollections(), api.listTags()]);
      set({ documents, byId: index(documents), collections, tags, loaded: true });
    } catch (e) {
      set({ loaded: true });
      toast.error("Could not load your library", { description: errorMessage(e) });
    }
  },
  refreshDocuments: async () => {
    const documents = await api.listDocuments();
    set({ documents, byId: index(documents) });
  },
  refreshCollections: async () => set({ collections: await api.listCollections() }),
  refreshTags: async () => set({ tags: await api.listTags() }),
  upsertDocuments: (docs) => {
    const map = { ...get().byId };
    const existing = new Set(get().documents.map((d) => d.id));
    for (const d of docs) map[d.id] = d;
    const documents = [...docs.filter((d) => !existing.has(d.id)), ...get().documents.map((d) => map[d.id])];
    set({ documents, byId: map });
  },
  dropDocuments: (ids) => {
    const drop = new Set(ids);
    const documents = get().documents.filter((d) => !drop.has(d.id));
    set({ documents, byId: index(documents) });
  },
}));

/** Refresh docs + collection/tag counts after a mutation that may affect them. */
export async function refreshLibrary() {
  const s = useLibrary.getState();
  await Promise.all([s.refreshDocuments(), s.refreshCollections(), s.refreshTags()]);
}
