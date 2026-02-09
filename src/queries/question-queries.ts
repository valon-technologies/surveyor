import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type { Question } from "@/types/question";

const basePath = workspacePath(DEFAULT_WORKSPACE_ID, "questions");

export function useQuestions(filters?: { status?: string; entityId?: string }) {
  return useQuery({
    queryKey: ["questions", DEFAULT_WORKSPACE_ID, filters],
    queryFn: () =>
      api.get<Question[]>(basePath, filters as Record<string, string>),
  });
}

export function useCreateQuestion() {
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
