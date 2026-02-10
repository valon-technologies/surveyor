import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { ReviewCardData } from "@/types/review";
import type { ConfidenceLevel, ReviewStatus } from "@/lib/constants";

interface ReviewQueueFilters {
  reviewStatus?: ReviewStatus | "all";
  confidence?: ConfidenceLevel | "all";
  entityId?: string | "all";
  sortBy?: string;
  sortOrder?: string;
}

export function useReviewQueue(filters?: ReviewQueueFilters) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "review-queue");

  const params: Record<string, string> = {};
  if (filters?.reviewStatus && filters.reviewStatus !== "all")
    params.reviewStatus = filters.reviewStatus;
  if (filters?.confidence && filters.confidence !== "all")
    params.confidence = filters.confidence;
  if (filters?.entityId && filters.entityId !== "all")
    params.entityId = filters.entityId;
  if (filters?.sortBy) params.sortBy = filters.sortBy;
  if (filters?.sortOrder) params.sortOrder = filters.sortOrder;

  return useQuery({
    queryKey: ["review-queue", workspaceId, params],
    queryFn: () => api.get<ReviewCardData[]>(basePath, params),
  });
}

export function useAcceptMapping() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      api.post(`${basePath}/${mappingId}/accept`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useExcludeMapping() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      api.post(`${basePath}/${mappingId}/exclude`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUndoReview() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      api.post(`${basePath}/${mappingId}/undo-review`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function usePuntMapping() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      mappingId,
      ...data
    }: {
      mappingId: string;
      note: string;
      assignToSM?: boolean;
      questionText?: string;
      priority?: string;
    }) => api.post(`${basePath}/${mappingId}/punt`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["questions"] });
    },
  });
}
