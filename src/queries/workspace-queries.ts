import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { WorkspaceSettings } from "@/types/workspace";

export function useWorkspaceSettings() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["workspace-settings", workspaceId],
    queryFn: () =>
      api.get<WorkspaceSettings>(workspacePath(workspaceId, "settings")),
  });
}

export function useUpdateWorkspaceSettings() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<WorkspaceSettings>) =>
      api.patch<WorkspaceSettings>(
        workspacePath(workspaceId, "settings"),
        settings
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-settings"] });
    },
  });
}

export function useTestBqConnection() {
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (config: { projectId: string; sourceDataset: string }) =>
      api.post<{ success: boolean; error?: string }>(
        workspacePath(workspaceId, "settings/bigquery-test"),
        config
      ),
  });
}

export function useBqAuthStatus() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["bq-auth-status", workspaceId],
    queryFn: () =>
      api.get<{ status: "valid" | "expired" | "missing"; error?: string }>(
        workspacePath(workspaceId, "settings/bigquery-auth")
      ),
  });
}

export function useBqAuthLogin() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; message?: string; error?: string }>(
        workspacePath(workspaceId, "settings/bigquery-auth"),
        {}
      ),
    onSuccess: () => {
      // Re-check auth status after a delay (user needs to complete browser flow)
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["bq-auth-status"] });
      }, 5000);
    },
  });
}
