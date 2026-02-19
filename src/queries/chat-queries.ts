import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { ChatSession, ChatSessionWithMessages, EntityMappingUpdate } from "@/types/chat";
import type { PipelineStructureUpdate } from "@/types/pipeline";

export function useChatSessions() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "chat-sessions");
  return useQuery({
    queryKey: ["chat-sessions", workspaceId],
    queryFn: () => api.get<ChatSession[]>(basePath),
  });
}

export function useChatSessionsByMapping(fieldMappingId: string | null) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "chat-sessions");
  return useQuery({
    queryKey: ["chat-sessions", workspaceId, "by-mapping", fieldMappingId],
    queryFn: () =>
      api.get<ChatSession[]>(basePath, { fieldMappingId: fieldMappingId! }),
    enabled: !!fieldMappingId,
  });
}

export function useChatSession(sessionId: string | null) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "chat-sessions");
  return useQuery({
    queryKey: ["chat-sessions", workspaceId, sessionId],
    queryFn: () =>
      api.get<ChatSessionWithMessages>(`${basePath}/${sessionId}`),
    enabled: !!sessionId,
  });
}

export function useCreateChatSession() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "chat-sessions");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { fieldMappingId: string }) =>
      api.post<ChatSession>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-sessions"] });
    },
  });
}

// ─── Entity Chat Session Hooks ───────────────────────────────

export function useEntityChatSessions(entityId: string | null) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "entity-chat-sessions");
  return useQuery({
    queryKey: ["entity-chat-sessions", workspaceId, entityId],
    queryFn: () =>
      api.get<ChatSession[]>(basePath, { entityId: entityId! }),
    enabled: !!entityId,
  });
}

export function useCreateEntityChatSession() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "entity-chat-sessions");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { entityId: string }) =>
      api.post<ChatSession>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entity-chat-sessions"] });
    },
  });
}

export function useApplyEntityUpdates() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sessionId: string;
      updates: EntityMappingUpdate[];
    }) => {
      const path = workspacePath(
        workspaceId,
        `entity-chat-sessions/${input.sessionId}/apply`
      );
      return api.post<{ applied: number; errors: string[] }>(path, {
        updates: input.updates,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["entity-chat-sessions"] });
    },
  });
}

export function useApplyPipelineUpdate() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sessionId: string;
      update: PipelineStructureUpdate;
    }) => {
      const path = workspacePath(
        workspaceId,
        `entity-chat-sessions/${input.sessionId}/apply-pipeline`
      );
      return api.post<{ success: boolean; changes: string[] }>(path, {
        update: input.update,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["sample-data"] });
      qc.invalidateQueries({ queryKey: ["entity-chat-sessions"] });
    },
  });
}
