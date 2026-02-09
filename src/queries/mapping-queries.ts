import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type { FieldMapping, FieldMappingCreateInput, FieldMappingUpdateInput, MappingWithContext, MappingHistoryEntry, MappingContextDetail } from "@/types/mapping";

const basePath = workspacePath(DEFAULT_WORKSPACE_ID, "mappings");

export function useMappings(filters?: { status?: string; entityId?: string }) {
  return useQuery({
    queryKey: ["mappings", DEFAULT_WORKSPACE_ID, filters],
    queryFn: () =>
      api.get<FieldMapping[]>(basePath, filters as Record<string, string>),
  });
}

export function useMapping(id: string | undefined) {
  return useQuery({
    queryKey: ["mappings", DEFAULT_WORKSPACE_ID, id],
    queryFn: () => api.get<MappingWithContext>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useMappingHistory(mappingId: string | undefined) {
  return useQuery({
    queryKey: ["mappings", DEFAULT_WORKSPACE_ID, mappingId, "history"],
    queryFn: () => api.get<MappingHistoryEntry[]>(`${basePath}/${mappingId}/history`),
    enabled: !!mappingId,
  });
}

export function useCreateMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FieldMappingCreateInput) => api.post<FieldMapping>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & FieldMappingUpdateInput) =>
      api.patch<FieldMapping>(`${basePath}/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${basePath}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useBulkCreateMappings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { mappings: FieldMappingCreateInput[]; generationId?: string }) =>
      api.post<FieldMapping[]>(`${basePath}/bulk`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useMappingContexts(mappingId: string | undefined) {
  return useQuery({
    queryKey: ["mappings", DEFAULT_WORKSPACE_ID, mappingId, "contexts"],
    queryFn: () =>
      api.get<MappingContextDetail[]>(`${basePath}/${mappingId}/contexts`),
    enabled: !!mappingId,
  });
}

export function useAddMappingContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      mappingId,
      ...data
    }: {
      mappingId: string;
      contextId: string;
      contextType?: string;
      excerpt?: string;
      relevance?: string;
    }) => api.post<MappingContextDetail>(`${basePath}/${mappingId}/contexts`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
    },
  });
}

export function useRemoveMappingContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mappingId, mcId }: { mappingId: string; mcId: string }) =>
      api.delete(`${basePath}/${mappingId}/contexts/${mcId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
    },
  });
}
