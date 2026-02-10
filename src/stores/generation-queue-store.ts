import { create } from "zustand";
import type { ParseResult } from "@/types/generation";

export interface QueuedGeneration {
  generationId: string;
  entityId: string;
  entityName: string;
  fieldCount: number;
  provider: string;
  model: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  error?: string;
  parsedOutput?: ParseResult;
  dismissed: boolean;
}

interface GenerationQueueState {
  queue: QueuedGeneration[];
  addGeneration: (gen: {
    generationId: string;
    entityId: string;
    entityName: string;
    fieldCount: number;
    provider: string;
    model: string;
  }) => void;
  updateGeneration: (
    generationId: string,
    updates: Partial<QueuedGeneration>
  ) => void;
  dismissGeneration: (generationId: string) => void;
  clearCompleted: () => void;
}

export const useGenerationQueueStore = create<GenerationQueueState>(
  (set) => ({
    queue: [],

    addGeneration: (gen) =>
      set((state) => ({
        queue: [
          {
            ...gen,
            status: "running",
            startedAt: Date.now(),
            dismissed: false,
          },
          ...state.queue,
        ],
      })),

    updateGeneration: (generationId, updates) =>
      set((state) => ({
        queue: state.queue.map((g) =>
          g.generationId === generationId ? { ...g, ...updates } : g
        ),
      })),

    dismissGeneration: (generationId) =>
      set((state) => ({
        queue: state.queue.map((g) =>
          g.generationId === generationId ? { ...g, dismissed: true } : g
        ),
      })),

    clearCompleted: () =>
      set((state) => ({
        queue: state.queue.filter((g) => g.status === "running"),
      })),
  })
);

// Derived selectors
export const selectRunningCount = (state: GenerationQueueState) =>
  state.queue.filter((g) => g.status === "running").length;

export const selectHasUndismissed = (state: GenerationQueueState) =>
  state.queue.some((g) => !g.dismissed && g.status !== "running");
