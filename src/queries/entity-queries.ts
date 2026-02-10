import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { Entity } from "@/types/entity";
import type { FieldWithMapping } from "@/types/field";

export function useEntities(filters?: {
  side?: string;
  status?: string;
  search?: string;
}) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "entities");
  return useQuery({
    queryKey: ["entities", workspaceId, filters],
    queryFn: () =>
      api.get<(Entity & { fieldCount: number; statusBreakdown: Record<string, number> })[]>(basePath, filters as Record<string, string>),
  });
}

export function useEntity(id: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "entities");
  return useQuery({
    queryKey: ["entities", workspaceId, id],
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
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "entities");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch<Entity>(`${basePath}/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
