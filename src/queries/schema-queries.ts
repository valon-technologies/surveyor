import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { SchemaAsset, SchemaAssetWithEntities, SchemaAssetCreateInput } from "@/types/schema";

export function useSchemaAssets() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "schemas");
  return useQuery({
    queryKey: ["schemas", workspaceId],
    queryFn: () => api.get<(SchemaAsset & { entityCount: number })[]>(basePath),
  });
}

export function useSchemaAsset(id: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "schemas");
  return useQuery({
    queryKey: ["schemas", workspaceId, id],
    queryFn: () => api.get<SchemaAssetWithEntities>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useCreateSchemaAsset() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "schemas");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SchemaAssetCreateInput) => api.post<SchemaAsset>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schemas"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteSchemaAsset() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "schemas");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${basePath}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schemas"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
