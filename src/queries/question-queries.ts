import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { Question, QuestionReply } from "@/types/question";

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

export function useQuestionReplies(questionId: string | null) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  return useQuery({
    queryKey: ["questionReplies", workspaceId, questionId],
    queryFn: () => api.get<QuestionReply[]>(`${basePath}/${questionId}/replies`),
    enabled: !!questionId,
  });
}

export function useCreateQuestionReply(questionId: string) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string }) =>
      api.post<QuestionReply>(`${basePath}/${questionId}/replies`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questionReplies", workspaceId, questionId] });
      qc.invalidateQueries({ queryKey: ["questions"] });
    },
  });
}

export function useResolveQuestion() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: string }) =>
      api.post<Question>(`${basePath}/${id}/resolve`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions"] });
      qc.invalidateQueries({ queryKey: ["questionReplies"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });

      // AI evaluation runs async — re-check after delay in case it reopened
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["questions"] });
        qc.invalidateQueries({ queryKey: ["questionReplies"] });
      }, 5000);
    },
  });
}

export function useReopenQuestion() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Question>(`${basePath}/${id}/reopen`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateQuestionFeedback() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "questions");
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      feedbackHelpful?: boolean;
      feedbackWhyNot?: string;
      feedbackBetterQuestion?: string;
    }) => api.patch(`${basePath}/${id}/feedback`, data),
  });
}
