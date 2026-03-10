import { create } from "zustand";
import type { ConfidenceLevel, MappingStatus, Milestone } from "@/lib/constants";
import type { ReviewSortBy, ReviewSortOrder } from "@/types/review";

interface ReviewState {
  confidenceFilter: ConfidenceLevel | "all";
  setConfidenceFilter: (c: ConfidenceLevel | "all") => void;

  entityFilter: string | "all";
  setEntityFilter: (e: string | "all") => void;

  statusFilter: MappingStatus | "all";
  setStatusFilter: (s: MappingStatus | "all") => void;

  milestoneFilter: Milestone | "all";
  setMilestoneFilter: (m: Milestone | "all") => void;

  sortBy: ReviewSortBy;
  setSortBy: (s: ReviewSortBy) => void;

  sortOrder: ReviewSortOrder;
  setSortOrder: (o: ReviewSortOrder) => void;

  activeBatchRunId: string | null;
  setActiveBatchRunId: (id: string | null) => void;

  assigneeFilter: "all" | "mine" | "unclaimed";
  setAssigneeFilter: (v: "all" | "mine" | "unclaimed") => void;

  hideSystemFields: boolean;
  setHideSystemFields: (v: boolean) => void;

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

  milestoneFilter: "M2.5",
  setMilestoneFilter: (m) => set({ milestoneFilter: m }),

  sortBy: "confidence",
  setSortBy: (s) => set({ sortBy: s }),

  sortOrder: "asc",
  setSortOrder: (o) => set({ sortOrder: o }),

  activeBatchRunId: null,
  setActiveBatchRunId: (id) => set({ activeBatchRunId: id }),

  assigneeFilter: "all",
  setAssigneeFilter: (v) => set({ assigneeFilter: v }),

  hideSystemFields: true,
  setHideSystemFields: (v) => set({ hideSystemFields: v }),

  collapsedEntityIds: [],
  toggleEntityCollapsed: (entityId) =>
    set((state) => ({
      collapsedEntityIds: state.collapsedEntityIds.includes(entityId)
        ? state.collapsedEntityIds.filter((id) => id !== entityId)
        : [...state.collapsedEntityIds, entityId],
    })),
}));
