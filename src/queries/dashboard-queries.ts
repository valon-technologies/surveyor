import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { DashboardStats, MyWorkData } from "@/types/dashboard";

export function useDashboardStats(milestone?: string) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["dashboard", workspaceId, milestone],
    queryFn: () =>
      api.get<DashboardStats>(workspacePath(workspaceId, "dashboard"), {
        milestone,
      }),
  });
}

export function useMyWork() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["dashboard-my-work", workspaceId],
    queryFn: () =>
      api.get<MyWorkData>(workspacePath(workspaceId, "dashboard"), {
        tab: "my-work",
      }),
  });
}
