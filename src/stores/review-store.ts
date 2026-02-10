import { create } from "zustand";
import type { ConfidenceLevel, ReviewStatus } from "@/lib/constants";
import type { ReviewSortBy, ReviewSortOrder } from "@/types/review";

interface ReviewState {
  confidenceFilter: ConfidenceLevel | "all";
  setConfidenceFilter: (c: ConfidenceLevel | "all") => void;

  entityFilter: string | "all";
  setEntityFilter: (e: string | "all") => void;

  reviewStatusFilter: ReviewStatus | "all";
  setReviewStatusFilter: (s: ReviewStatus | "all") => void;

  sortBy: ReviewSortBy;
  setSortBy: (s: ReviewSortBy) => void;

  sortOrder: ReviewSortOrder;
  setSortOrder: (o: ReviewSortOrder) => void;

  activeBatchRunId: string | null;
  setActiveBatchRunId: (id: string | null) => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  confidenceFilter: "all",
  setConfidenceFilter: (c) => set({ confidenceFilter: c }),

  entityFilter: "all",
  setEntityFilter: (e) => set({ entityFilter: e }),

  reviewStatusFilter: "all",
  setReviewStatusFilter: (s) => set({ reviewStatusFilter: s }),

  sortBy: "confidence",
  setSortBy: (s) => set({ sortBy: s }),

  sortOrder: "asc",
  setSortOrder: (o) => set({ sortOrder: o }),

  activeBatchRunId: null,
  setActiveBatchRunId: (id) => set({ activeBatchRunId: id }),
}));
