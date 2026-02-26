import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { FieldMapping, FieldMappingCreateInput, FieldMappingUpdateInput, MappingWithContext, MappingHistoryEntry, MappingContextDetail } from "@/types/mapping";

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  fieldMappingId: string | null;
  entityId: string | null;
  actorId: string | null;
  actorName: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface ValidationResult {
  id: string;
  fieldMappingId: string;
  status: "passed" | "failed" | "error";
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  durationMs: number | null;
  ranBy: string | null;
  createdAt: string;
}

export function useMappings(filters?: { status?: string; entityId?: string }) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  return useQuery({
    queryKey: ["mappings", workspaceId, filters],
    queryFn: () =>
      api.get<FieldMapping[]>(basePath, filters as Record<string, string>),
  });
}

export function useMapping(id: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  return useQuery({
    queryKey: ["mappings", workspaceId, id],
    queryFn: () => api.get<MappingWithContext>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useMappingHistory(mappingId: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  return useQuery({
    queryKey: ["mappings", workspaceId, mappingId, "history"],
    queryFn: () => api.get<MappingHistoryEntry[]>(`${basePath}/${mappingId}/history`),
    enabled: !!mappingId,
  });
}

export function useCreateMapping() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FieldMappingCreateInput) => api.post<FieldMapping>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useUpdateMapping() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & FieldMappingUpdateInput) =>
      api.patch<FieldMapping>(`${basePath}/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["sample-data"] });
    },
  });
}

export function useDeleteMapping() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
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
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { mappings: FieldMappingCreateInput[]; generationId?: string }) =>
      api.post<FieldMapping[]>(`${basePath}/bulk`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useMappingContexts(mappingId: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  return useQuery({
    queryKey: ["mappings", workspaceId, mappingId, "contexts"],
    queryFn: () =>
      api.get<MappingContextDetail[]>(`${basePath}/${mappingId}/contexts`),
    enabled: !!mappingId,
  });
}

export function useAddMappingContext() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
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
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mappingId, mcId }: { mappingId: string; mcId: string }) =>
      api.delete(`${basePath}/${mappingId}/contexts/${mcId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
    },
  });
}

export function useFieldActivity(fieldMappingId: string | undefined) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["activity", workspaceId, fieldMappingId],
    queryFn: () =>
      api.get<ActivityEntry[]>(
        workspacePath(workspaceId, "activity"),
        { fieldMappingId: fieldMappingId! }
      ),
    enabled: !!fieldMappingId,
  });
}

export function useCloseCase() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      api.post<FieldMapping>(`${basePath}/${mappingId}/close`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useReopenCase() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      api.post<FieldMapping>(`${basePath}/${mappingId}/reopen`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRunValidation() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      api.post<ValidationResult>(`${basePath}/${mappingId}/validate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validations"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export function useLatestValidation(mappingId: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  return useQuery({
    queryKey: ["validations", workspaceId, mappingId],
    queryFn: () =>
      api.get<ValidationResult>(`${basePath}/${mappingId}/validate`),
    enabled: !!mappingId,
  });
}

export function useUpdateMappingVerdict() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "mappings");
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      sourceVerdict?: string;
      sourceVerdictNotes?: string;
      transformVerdict?: string;
      transformVerdictNotes?: string;
    }) => api.patch(`${basePath}/${id}/verdict`, data),
  });
}
