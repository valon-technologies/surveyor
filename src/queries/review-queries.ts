import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { ReviewCardData, VerdictHistoryItem } from "@/types/review";
import type { ConfidenceLevel, MappingStatus } from "@/lib/constants";

interface ReviewQueueFilters {
  status?: MappingStatus | "all";
  confidence?: ConfidenceLevel | "all";
  entityId?: string | "all";
  sortBy?: string;
  sortOrder?: string;
}

export function useReviewQueue(filters?: ReviewQueueFilters) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "review-queue");

  const params: Record<string, string> = {};
  if (filters?.status && filters.status !== "all")
    params.status = filters.status;
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

export function useMyVerdicts() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["my-verdicts", workspaceId],
    queryFn: () => api.get<VerdictHistoryItem[]>(workspacePath(workspaceId, "my-verdicts")),
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
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["sample-data"] });
    },
  });
}

export function useExcludeMapping() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mappingId, reason }: { mappingId: string; reason?: string }) =>
      api.post(`${basePath}/${mappingId}/exclude`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["sample-data"] });
    },
  });
}

export function useBatchExclude() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mappingIds, reason }: { mappingIds: string[]; reason?: string }) =>
      api.post(`${basePath}/batch-exclude`, { mappingIds, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["sample-data"] });
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
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["sample-data"] });
    },
  });
}

export function useReassignMapping() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mappingId, assigneeId }: { mappingId: string; assigneeId: string | null }) =>
      api.patch(`${basePath}/${mappingId}`, { assigneeId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
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
      assigneeId?: string;
    }) => api.post(`${basePath}/${mappingId}/punt`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["questions"] });
    },
  });
}
