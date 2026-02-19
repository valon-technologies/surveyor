import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { ChatSession } from "@/types/chat";

export function useForgeSessions(entityName?: string, skillId?: string) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "forge-sessions");
  return useQuery({
    queryKey: ["forge-sessions", workspaceId, entityName, skillId],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (entityName) params.entityName = entityName;
      if (skillId) params.skillId = skillId;
      return api.get<ChatSession[]>(basePath, params);
    },
  });
}

export function useCreateForgeSession() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "forge-sessions");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { entityName: string; skillId?: string }) =>
      api.post<ChatSession>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge-sessions"] });
    },
  });
}

export interface ApplyForgeSkillInput {
  name: string;
  description?: string;
  applicability?: {
    entityPatterns?: string[];
    fieldPatterns?: string[];
    dataTypes?: string[];
  };
  contexts: Array<{
    contextId: string;
    contextName?: string;
    role: "primary" | "reference" | "supplementary";
    tokenCount?: number;
  }>;
  reasoning?: string;
}

export interface ApplyForgeSkillResult {
  action: "created" | "updated";
  skillId: string;
  contextsAdded: number;
  contextsRemoved: number;
  contextsUpdated: number;
}

export function useApplyForgeSkill() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sessionId: string; skill: ApplyForgeSkillInput }) => {
      const path = workspacePath(
        workspaceId,
        `forge-sessions/${input.sessionId}/apply`
      );
      return api.post<ApplyForgeSkillResult>(path, input.skill);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["forge-sessions"] });
    },
  });
}
