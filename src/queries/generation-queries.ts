import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { Generation, GenerationStartResult } from "@/types/generation";
import type { CreateGenerationInput } from "@/lib/validators/generation";

export function useGenerations(filters?: { entityId?: string }) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "generations");
  return useQuery({
    queryKey: ["generations", workspaceId, filters],
    queryFn: () =>
      api.get<Generation[]>(basePath, filters as Record<string, string>),
  });
}

export function useGeneration(id: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "generations");
  return useQuery({
    queryKey: ["generations", workspaceId, id],
    queryFn: () => api.get<Generation>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useRunGeneration() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "generations");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGenerationInput) =>
      api.post<GenerationStartResult>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
}

export function useGenerationPoll(generationId: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "generations");
  return useQuery({
    queryKey: ["generation-poll", workspaceId, generationId],
    queryFn: () => api.get<Generation>(`${basePath}/${generationId}`),
    enabled: !!generationId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "completed" || data.status === "failed")) {
        return false;
      }
      return 2000;
    },
    staleTime: 0,
  });
}
