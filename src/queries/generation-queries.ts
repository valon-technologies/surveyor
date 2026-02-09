import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type { Generation } from "@/types/generation";

const basePath = workspacePath(DEFAULT_WORKSPACE_ID, "generations");

export function useGenerations(filters?: { entityId?: string }) {
  return useQuery({
    queryKey: ["generations", DEFAULT_WORKSPACE_ID, filters],
    queryFn: () =>
      api.get<Generation[]>(basePath, filters as Record<string, string>),
  });
}

export function useGeneration(id: string | undefined) {
  return useQuery({
    queryKey: ["generations", DEFAULT_WORKSPACE_ID, id],
    queryFn: () => api.get<Generation>(`${basePath}/${id}`),
    enabled: !!id,
  });
}
