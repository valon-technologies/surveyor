import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { CommentThread, ThreadWithComments, CreateThreadInput, CreateCommentInput } from "@/types/thread";

export function useThreads(filters?: {
  entityId?: string;
  fieldMappingId?: string;
  status?: string;
}) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "threads");
  return useQuery({
    queryKey: ["threads", workspaceId, filters],
    queryFn: () =>
      api.get<CommentThread[]>(basePath, filters as Record<string, string>),
    enabled: !!(filters?.entityId || filters?.fieldMappingId),
  });
}

export function useThread(threadId: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "threads");
  return useQuery({
    queryKey: ["threads", workspaceId, threadId],
    queryFn: () => api.get<ThreadWithComments>(`${basePath}/${threadId}`),
    enabled: !!threadId,
  });
}

export function useCreateThread() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "threads");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateThreadInput) => api.post<ThreadWithComments>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useAddComment() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "threads");
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
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "threads");
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
