import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { BatchRun } from "@/types/chat";

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

export function useStartBatchRun() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "batch-runs");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config?: {
      preferredProvider?: "claude" | "openai";
      model?: string;
      skipAlreadyMapped?: boolean;
    }) => api.post<{ batchRunId: string; totalEntities: number; totalFields: number }>(
      basePath,
      config || {}
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch-runs"] });
    },
  });
}
