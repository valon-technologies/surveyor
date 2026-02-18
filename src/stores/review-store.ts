import { create } from "zustand";
import type { ConfidenceLevel, MappingStatus } from "@/lib/constants";
import type { ReviewSortBy, ReviewSortOrder } from "@/types/review";

interface ReviewState {
  confidenceFilter: ConfidenceLevel | "all";
  setConfidenceFilter: (c: ConfidenceLevel | "all") => void;

  entityFilter: string | "all";
  setEntityFilter: (e: string | "all") => void;

  statusFilter: MappingStatus | "all";
  setStatusFilter: (s: MappingStatus | "all") => void;

  sortBy: ReviewSortBy;
  setSortBy: (s: ReviewSortBy) => void;

  sortOrder: ReviewSortOrder;
  setSortOrder: (o: ReviewSortOrder) => void;

  activeBatchRunId: string | null;
  setActiveBatchRunId: (id: string | null) => void;

  collapsedEntityIds: string[];
  toggleEntityCollapsed: (entityId: string) => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  confidenceFilter: "all",
  setConfidenceFilter: (c) => set({ confidenceFilter: c }),

  entityFilter: "all",
  setEntityFilter: (e) => set({ entityFilter: e }),

  statusFilter: "all",
  setStatusFilter: (s) => set({ statusFilter: s }),

  sortBy: "confidence",
  setSortBy: (s) => set({ sortBy: s }),

  sortOrder: "asc",
  setSortOrder: (o) => set({ sortOrder: o }),

  activeBatchRunId: null,
  setActiveBatchRunId: (id) => set({ activeBatchRunId: id }),

  collapsedEntityIds: [],
  toggleEntityCollapsed: (entityId) =>
    set((state) => ({
      collapsedEntityIds: state.collapsedEntityIds.includes(entityId)
        ? state.collapsedEntityIds.filter((id) => id !== entityId)
        : [...state.collapsedEntityIds, entityId],
    })),
}));
