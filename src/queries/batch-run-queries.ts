import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { BatchRun, ChatMessage } from "@/types/chat";

export function useBatchRuns() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "batch-runs");
  return useQuery({
    queryKey: ["batch-runs", workspaceId],
    queryFn: () => api.get<BatchRun[]>(basePath),
  });
}

export function useBatchRun(id: string | null) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "batch-runs");
  return useQuery({
    queryKey: ["batch-runs", workspaceId, id],
    queryFn: () => api.get<BatchRun>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useBatchRunPoll(id: string | null) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "batch-runs");
  return useQuery({
    queryKey: ["batch-runs", workspaceId, id, "poll"],
    queryFn: () => api.get<BatchRun>(`${basePath}/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as BatchRun | undefined;
      if (!data) return 2000;
      return data.status === "running" || data.status === "pending"
        ? 2000
        : false;
    },
  });
}

export interface BatchRunSession {
  id: string;
  fieldMappingId: string | null;
  fieldName: string | null;
  entityName: string | null;
  status: string;
  messageCount: number;
  createdAt: string;
  messages: ChatMessage[];
  mappingResult: Record<string, unknown> | null;
  mappingSummary: {
    mappingType: string | null;
    confidence: string | null;
    status: string | null;
  } | null;
}

interface BatchRunSessionsResponse {
  sessions: BatchRunSession[];
  batchRun: BatchRun;
}

export function useBatchRunSessions(id: string | null) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "batch-runs");
  return useQuery({
    queryKey: ["batch-run-sessions", workspaceId, id],
    queryFn: () =>
      api.get<BatchRunSessionsResponse>(`${basePath}/${id}/sessions`),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as BatchRunSessionsResponse | undefined;
      if (!data) return 3000;
      const status = data.batchRun.status;
      return status === "running" || status === "pending" ? 3000 : false;
    },
  });
}

export function useStartBatchRun() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "batch-runs");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config?: {
      preferredProvider?: "claude" | "openai";
      model?: string;
      skipAlreadyMapped?: boolean;
      includeStatuses?: string[];
      outputFormat?: "json" | "yaml";
      mode?: "single-shot" | "chat";
      entityIds?: string[];
    }) => api.post<{ batchRunId: string; totalEntities: number; totalFields: number }>(
      basePath,
      config || {}
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch-runs"] });
    },
  });
}
