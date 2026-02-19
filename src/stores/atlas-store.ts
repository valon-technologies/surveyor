import { create } from "zustand";

interface AtlasState {
  leftPanelCollapsed: boolean;
  selectedEntityId: string | null;
  searchQuery: string;

  toggleLeftPanel: () => void;
  selectEntity: (id: string) => void;
  clearSelection: () => void;
  setSearchQuery: (q: string) => void;
}

export const useAtlasStore = create<AtlasState>((set) => ({
  leftPanelCollapsed: false,
  selectedEntityId: null,
  searchQuery: "",

  toggleLeftPanel: () =>
    set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),

  selectEntity: (id) => set({ selectedEntityId: id }),

  clearSelection: () => set({ selectedEntityId: null }),

  setSearchQuery: (q) => set({ searchQuery: q }),
}));
