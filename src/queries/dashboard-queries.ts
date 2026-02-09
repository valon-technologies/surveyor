import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type { DashboardStats } from "@/types/dashboard";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", DEFAULT_WORKSPACE_ID],
    queryFn: () =>
      api.get<DashboardStats>(workspacePath(DEFAULT_WORKSPACE_ID, "dashboard")),
  });
}
