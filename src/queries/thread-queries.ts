import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type { CommentThread, ThreadWithComments, CreateThreadInput, CreateCommentInput } from "@/types/thread";

const basePath = workspacePath(DEFAULT_WORKSPACE_ID, "threads");

export function useThreads(filters?: {
  entityId?: string;
  fieldMappingId?: string;
  status?: string;
}) {
  return useQuery({
    queryKey: ["threads", DEFAULT_WORKSPACE_ID, filters],
    queryFn: () =>
      api.get<CommentThread[]>(basePath, filters as Record<string, string>),
    enabled: !!(filters?.entityId || filters?.fieldMappingId),
  });
}

export function useThread(threadId: string | undefined) {
  return useQuery({
    queryKey: ["threads", DEFAULT_WORKSPACE_ID, threadId],
    queryFn: () => api.get<ThreadWithComments>(`${basePath}/${threadId}`),
    enabled: !!threadId,
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateThreadInput) => api.post<ThreadWithComments>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, ...input }: CreateCommentInput & { threadId: string }) =>
      api.post(`${basePath}/${threadId}/comments`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useUpdateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      threadId,
      ...data
    }: {
      threadId: string;
      status?: string;
      resolvedBy?: string;
      subject?: string;
    }) => api.patch(`${basePath}/${threadId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}
