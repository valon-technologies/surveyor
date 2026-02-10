import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { ChatSession, ChatSessionWithMessages } from "@/types/chat";

export function useChatSessions() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "chat-sessions");
  return useQuery({
    queryKey: ["chat-sessions", workspaceId],
    queryFn: () => api.get<ChatSession[]>(basePath),
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
