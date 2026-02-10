import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { Question } from "@/types/question";

export function useQuestions(filters?: { status?: string; entityId?: string }) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  return useQuery({
    queryKey: ["questions", workspaceId, filters],
    queryFn: () =>
      api.get<Question[]>(basePath, filters as Record<string, string>),
  });
}

export function useCreateQuestion() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { entityId?: string; fieldId?: string; question: string }) =>
      api.post<Question>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateQuestion() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch<Question>(`${basePath}/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
