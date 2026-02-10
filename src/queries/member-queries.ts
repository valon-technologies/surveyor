import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";

export interface WorkspaceMember {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  team: string | null;
  joinedAt: string;
}

export function useWorkspaceMembers() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api.get<WorkspaceMember[]>(workspacePath(workspaceId, "members")),
    enabled: !!workspaceId,
  });
}
