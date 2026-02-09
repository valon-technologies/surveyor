import { create } from "zustand";
import type { MappingStatus, EntityStatus } from "@/lib/constants";

interface MappingState {
  selectedFieldId: string | null;
  setSelectedFieldId: (id: string | null) => void;

  filterStatus: MappingStatus | "all";
  setFilterStatus: (status: MappingStatus | "all") => void;

  entityStatusFilter: EntityStatus | "all";
  setEntityStatusFilter: (status: EntityStatus | "all") => void;

  tierFilter: string | "all";
  setTierFilter: (tier: string | "all") => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const useMappingStore = create<MappingState>((set) => ({
  selectedFieldId: null,
  setSelectedFieldId: (id) => set({ selectedFieldId: id }),

  filterStatus: "all",
  setFilterStatus: (status) => set({ filterStatus: status }),

  entityStatusFilter: "all",
  setEntityStatusFilter: (status) => set({ entityStatusFilter: status }),

  tierFilter: "all",
  setTierFilter: (tier) => set({ tierFilter: tier }),

  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
