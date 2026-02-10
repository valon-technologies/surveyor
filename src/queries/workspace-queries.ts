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
