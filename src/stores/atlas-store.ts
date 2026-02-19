import { create } from "zustand";

interface AtlasState {
  leftPanelCollapsed: boolean;
  searchQuery: string;

  toggleLeftPanel: () => void;
  setSearchQuery: (q: string) => void;
}

export const useAtlasStore = create<AtlasState>((set) => ({
  leftPanelCollapsed: false,
  searchQuery: "",

  toggleLeftPanel: () =>
    set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),

  setSearchQuery: (q) => set({ searchQuery: q }),
}));
