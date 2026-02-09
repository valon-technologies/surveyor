import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type { Entity, EntityWithStats } from "@/types/entity";
import type { FieldWithMapping } from "@/types/field";

const basePath = workspacePath(DEFAULT_WORKSPACE_ID, "entities");

export function useEntities(filters?: {
  side?: string;
  status?: string;
  tier?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ["entities", DEFAULT_WORKSPACE_ID, filters],
    queryFn: () =>
      api.get<(Entity & { fieldCount: number })[]>(basePath, filters as Record<string, string>),
  });
}

export function useEntity(id: string | undefined) {
  return useQuery({
    queryKey: ["entities", DEFAULT_WORKSPACE_ID, id],
    queryFn: () =>
      api.get<
        Entity & {
          fields: FieldWithMapping[];
          fieldCount: number;
          mappedCount: number;
          unmappedCount: number;
          coveragePercent: number;
          openQuestions: number;
        }
      >(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useUpdateEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch<Entity>(`${basePath}/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
