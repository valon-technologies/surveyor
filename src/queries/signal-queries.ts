import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";

// ─── Types ─────────────────────────────────────────────────────

export interface SignalQueueEntry {
  entityId: string;
  entityName: string;
  score: number;
  signalCount: number;
  latestSignal: string;
  shouldRefresh: boolean;
}

export interface SkillRefreshSummary {
  id: string;
  skillId: string;
  skillName: string | null;
  status: string;
  triggerScore: number;
  signalCount: number;
  proposal: {
    additions: { contextId: string; contextName: string; role: string }[];
    removals: { contextId: string; contextName: string }[];
    roleChanges: { contextId: string; contextName: string; fromRole: string; toRole: string }[];
    instructionUpdate?: string;
    riskScore: number;
  } | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Signal Queue ──────────────────────────────────────────────

export function useSignalQueue() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["signal-queue", workspaceId],
    queryFn: () =>
      api.get<SignalQueueEntry[]>(
        workspacePath(workspaceId, "skill-signals"),
      ),
    refetchInterval: 30_000, // Auto-refresh every 30s
  });
}

// ─── Skill Refreshes ───────────────────────────────────────────

export function useSkillRefreshes(statusFilter?: string) {
  const { workspaceId } = useWorkspace();
  const params: Record<string, string> = {};
  if (statusFilter) params.status = statusFilter;

  return useQuery({
    queryKey: ["skill-refreshes", workspaceId, statusFilter],
    queryFn: () =>
      api.get<SkillRefreshSummary[]>(
        workspacePath(workspaceId, "skill-refreshes"),
        params,
      ),
  });
}

export function useSkillRefresh(refreshId: string) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["skill-refresh", workspaceId, refreshId],
    queryFn: () =>
      api.get<SkillRefreshSummary>(
        workspacePath(workspaceId, `skill-refreshes/${refreshId}`),
      ),
    enabled: !!refreshId,
  });
}

// ─── Mutations ─────────────────────────────────────────────────

export function useTriggerRefresh() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: { skillId?: string; entityId: string }) =>
      api.post(workspacePath(workspaceId, "skill-refreshes"), input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-queue"] });
      qc.invalidateQueries({ queryKey: ["skill-refreshes"] });
    },
  });
}

export function useApproveRefresh() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (refreshId: string) =>
      api.post(`${workspacePath(workspaceId, `skill-refreshes/${refreshId}`)}/apply`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-refreshes"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useRejectRefresh() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (refreshId: string) =>
      fetch(
        workspacePath(workspaceId, `skill-refreshes/${refreshId}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "rejected" }),
        },
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to reject refresh");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-refreshes"] });
    },
  });
}
