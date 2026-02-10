import { create } from "zustand";
import type { MappingStatus, EntityStatus, Milestone } from "@/lib/constants";

interface MappingState {
  selectedFieldId: string | null;
  setSelectedFieldId: (id: string | null) => void;

  filterStatus: MappingStatus | "all";
  setFilterStatus: (status: MappingStatus | "all") => void;

  entityStatusFilter: EntityStatus | "all";
  setEntityStatusFilter: (status: EntityStatus | "all") => void;

  milestoneFilter: Milestone | "all";
  setMilestoneFilter: (m: Milestone | "all") => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;

  autoMapSheetOpen: boolean;
  setAutoMapSheetOpen: (open: boolean) => void;

  reviewGenerationId: string | null;
  setReviewGenerationId: (id: string | null) => void;
}

export const useMappingStore = create<MappingState>((set) => ({
  selectedFieldId: null,
  setSelectedFieldId: (id) => set({ selectedFieldId: id }),

  filterStatus: "all",
  setFilterStatus: (status) => set({ filterStatus: status }),

  entityStatusFilter: "all",
  setEntityStatusFilter: (status) => set({ entityStatusFilter: status }),

  milestoneFilter: "all",
  setMilestoneFilter: (m) => set({ milestoneFilter: m }),

  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),

  autoMapSheetOpen: false,
  setAutoMapSheetOpen: (open) => set({ autoMapSheetOpen: open }),

  reviewGenerationId: null,
  setReviewGenerationId: (id) => set({ reviewGenerationId: id }),
}));
