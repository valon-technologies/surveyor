import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type { Context, ContextCreateInput, ContextUpdateInput } from "@/types/context";

const basePath = workspacePath(DEFAULT_WORKSPACE_ID, "contexts");

export function useContexts(filters?: {
  category?: string;
  subcategory?: string;
  entityId?: string;
  fieldId?: string;
  isActive?: string;
}) {
  return useQuery({
    queryKey: ["contexts", DEFAULT_WORKSPACE_ID, filters],
    queryFn: () =>
      api.get<Context[]>(basePath, filters as Record<string, string>),
  });
}

export function useContext(id: string | undefined) {
  return useQuery({
    queryKey: ["contexts", DEFAULT_WORKSPACE_ID, id],
    queryFn: () => api.get<Context>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useCreateContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContextCreateInput) => api.post<Context>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contexts"] });
    },
  });
}

export function useUpdateContext() {
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${basePath}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contexts"] });
    },
  });
}
