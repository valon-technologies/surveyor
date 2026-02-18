import { create } from "zustand";

type TopologyStatusFilter = "all" | "mapped" | "unmapped";
type CodeFormat = "sql" | "json" | "yaml";

interface TopologyState {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  expandedEntityIds: string[];
  selectedEntityId: string | null;
  selectedFieldId: string | null;
  selectedMappingId: string | null;
  searchQuery: string;
  statusFilter: TopologyStatusFilter;
  codeFormat: CodeFormat;

  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleEntity: (id: string) => void;
  selectEntity: (entityId: string) => void;
  selectField: (
    entityId: string,
    fieldId: string,
    mappingId: string | null
  ) => void;
  clearSelection: () => void;
  setSearchQuery: (q: string) => void;
  setStatusFilter: (s: TopologyStatusFilter) => void;
  setCodeFormat: (f: CodeFormat) => void;
  hydrateFromParams: (params: {
    entityId?: string;
    fieldId?: string;
    mappingId?: string;
  }) => void;
}

export const useTopologyStore = create<TopologyState>((set) => ({
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  expandedEntityIds: [],
  selectedEntityId: null,
  selectedFieldId: null,
  selectedMappingId: null,
  searchQuery: "",
  statusFilter: "mapped",
  codeFormat: "sql",

  toggleLeftPanel: () =>
    set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),

  toggleRightPanel: () =>
    set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),

  toggleEntity: (id) =>
    set((s) => ({
      expandedEntityIds: s.expandedEntityIds.includes(id)
        ? s.expandedEntityIds.filter((e) => e !== id)
        : [...s.expandedEntityIds, id],
    })),

  selectEntity: (entityId) =>
    set((s) => ({
      selectedEntityId: entityId,
      selectedFieldId: null,
      selectedMappingId: null,
      expandedEntityIds: s.expandedEntityIds.includes(entityId)
        ? s.expandedEntityIds
        : [...s.expandedEntityIds, entityId],
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
  setCodeFormat: (f) => set({ codeFormat: f }),

  hydrateFromParams: (params) =>
    set((s) => ({
      selectedEntityId: params.entityId || null,
      selectedFieldId: params.fieldId || null,
      selectedMappingId: params.mappingId || null,
      expandedEntityIds: params.entityId
        ? s.expandedEntityIds.includes(params.entityId)
          ? s.expandedEntityIds
          : [...s.expandedEntityIds, params.entityId]
        : s.expandedEntityIds,
    })),
}));
