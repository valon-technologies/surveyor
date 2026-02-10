import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { Context, ContextCreateInput, ContextUpdateInput } from "@/types/context";

export function useContexts(filters?: {
  category?: string;
  subcategory?: string;
  entityId?: string;
  fieldId?: string;
  isActive?: string;
}) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "contexts");
  return useQuery({
    queryKey: ["contexts", workspaceId, filters],
    queryFn: () =>
      api.get<Context[]>(basePath, filters as Record<string, string>),
  });
}

export function useContext(id: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "contexts");
  return useQuery({
    queryKey: ["contexts", workspaceId, id],
    queryFn: () => api.get<Context>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useCreateContext() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "contexts");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContextCreateInput) => api.post<Context>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contexts"] });
    },
  });
}

export function useUpdateContext() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "contexts");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & ContextUpdateInput) =>
      api.patch<Context>(`${basePath}/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contexts"] });
    },
  });
}

export function useDeleteContext() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "contexts");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${basePath}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contexts"] });
    },
  });
}
