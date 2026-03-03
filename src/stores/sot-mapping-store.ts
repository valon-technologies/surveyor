import { create } from "zustand";

interface SotMappingState {
  searchQuery: string;
  leftPanelCollapsed: boolean;
  expandedFields: Set<string>;

  setSearchQuery: (q: string) => void;
  toggleLeftPanel: () => void;
  toggleFieldExpanded: (fieldName: string) => void;
  collapseAllFields: () => void;
}

export const useSotMappingStore = create<SotMappingState>((set) => ({
  searchQuery: "",
  leftPanelCollapsed: false,
  expandedFields: new Set<string>(),

  setSearchQuery: (q) => set({ searchQuery: q }),

  toggleLeftPanel: () =>
    set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),

  toggleFieldExpanded: (fieldName) =>
    set((s) => {
      const next = new Set(s.expandedFields);
      if (next.has(fieldName)) {
        next.delete(fieldName);
      } else {
        next.add(fieldName);
      }
      return { expandedFields: next };
    }),

  collapseAllFields: () => set({ expandedFields: new Set<string>() }),
}));
