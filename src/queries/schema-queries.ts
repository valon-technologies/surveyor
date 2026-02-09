import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type { SchemaAsset, SchemaAssetWithEntities, SchemaAssetCreateInput } from "@/types/schema";

const basePath = workspacePath(DEFAULT_WORKSPACE_ID, "schemas");

export function useSchemaAssets() {
  return useQuery({
    queryKey: ["schemas", DEFAULT_WORKSPACE_ID],
    queryFn: () => api.get<(SchemaAsset & { entityCount: number })[]>(basePath),
  });
}

export function useSchemaAsset(id: string | undefined) {
  return useQuery({
    queryKey: ["schemas", DEFAULT_WORKSPACE_ID, id],
    queryFn: () => api.get<SchemaAssetWithEntities>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useCreateSchemaAsset() {
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
