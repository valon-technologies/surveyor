import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { DashboardStats } from "@/types/dashboard";

export function useDashboardStats() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["dashboard", workspaceId],
    queryFn: () =>
      api.get<DashboardStats>(workspacePath(workspaceId, "dashboard")),
  });
}
