import { create } from "zustand";

type AtlasStatusFilter = "unreviewed" | "accepted" | "all";

interface AtlasState {
  leftPanelCollapsed: boolean;
  expandedEntityIds: string[];
  selectedEntityId: string | null;
  selectedFieldId: string | null;
  selectedMappingId: string | null;
  searchQuery: string;
  statusFilter: AtlasStatusFilter;
  fromMapping: boolean;
  fromEntityId: string | null;

  toggleLeftPanel: () => void;
  toggleEntity: (id: string) => void;
  selectField: (entityId: string, fieldId: string, mappingId: string) => void;
  clearSelection: () => void;
  setSearchQuery: (q: string) => void;
  setStatusFilter: (s: AtlasStatusFilter) => void;
  hydrateFromParams: (params: {
    entityId?: string;
    fieldId?: string;
    mappingId?: string;
    from?: string;
    fromEntityId?: string;
  }) => void;
  clearFromMapping: () => void;
}

export const useAtlasStore = create<AtlasState>((set) => ({
  leftPanelCollapsed: false,
  expandedEntityIds: [],
  selectedEntityId: null,
  selectedFieldId: null,
  selectedMappingId: null,
  searchQuery: "",
  statusFilter: "unreviewed",
  fromMapping: false,
  fromEntityId: null,

  toggleLeftPanel: () =>
    set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),

  toggleEntity: (id) =>
    set((s) => ({
      expandedEntityIds: s.expandedEntityIds.includes(id)
        ? s.expandedEntityIds.filter((e) => e !== id)
        : [...s.expandedEntityIds, id],
    })),

  selectField: (entityId, fieldId, mappingId) =>
    set({
      selectedEntityId: entityId,
      selectedFieldId: fieldId,
      selectedMappingId: mappingId,
    }),

  clearSelection: () =>
    set({
      selectedEntityId: null,
      selectedFieldId: null,
      selectedMappingId: null,
    }),

  setSearchQuery: (q) => set({ searchQuery: q }),
  setStatusFilter: (s) => set({ statusFilter: s }),

  hydrateFromParams: (params) =>
    set((s) => ({
      selectedEntityId: params.entityId || null,
      selectedFieldId: params.fieldId || null,
      selectedMappingId: params.mappingId || null,
      fromMapping: params.from === "mapping",
      fromEntityId: params.fromEntityId || null,
      expandedEntityIds: params.entityId
        ? s.expandedEntityIds.includes(params.entityId)
          ? s.expandedEntityIds
          : [...s.expandedEntityIds, params.entityId]
        : s.expandedEntityIds,
    })),

  clearFromMapping: () => set({ fromMapping: false, fromEntityId: null }),
}));
