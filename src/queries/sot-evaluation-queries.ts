import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { FieldSourceMatch } from "@/lib/evaluation/source-matcher";

export interface SotEvaluationSummary {
  id: string;
  entityId: string;
  entityName: string | null;
  generationId: string | null;
  batchRunId: string | null;
  totalFields: number;
  scoredFields: number;
  sourceExactCount: number;
  sourceLenientCount: number;
  sourceExactPct: number;
  sourceLenientPct: number;
  createdAt: string;
}

interface SotEvaluationDetail extends SotEvaluationSummary {
  fieldResults: FieldSourceMatch[] | null;
}

interface SotEvaluationsResponse {
  evaluations: SotEvaluationSummary[];
  stats: {
    totalEvaluations: number;
    avgExactPct: number | null;
    avgLenientPct: number | null;
    totalScoredFields: number;
    totalExact: number;
    totalLenient: number;
  };
  availableEntities: string[];
}

interface RunEvalResponse {
  message: string;
  results: Array<{
    entityId: string;
    entityName: string;
    evaluationId?: string;
    status: "completed" | "skipped" | "failed";
    sourceExactPct?: number;
    sourceLenientPct?: number;
    error?: string;
  }>;
}

export function useSotEvaluations(entityId?: string) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["sot-evaluations", workspaceId, entityId],
    queryFn: () =>
      api.get<SotEvaluationsResponse>(
        workspacePath(workspaceId, "evaluations/sot"),
        entityId ? { entityId } : undefined,
      ),
  });
}

export function useSotEvaluationDetail(evaluationId: string | null) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["sot-evaluation-detail", workspaceId, evaluationId],
    queryFn: () =>
      api.get<SotEvaluationDetail>(
        workspacePath(workspaceId, `evaluations/sot/${evaluationId}`),
      ),
    enabled: !!evaluationId,
  });
}

export function useRunSotEvaluation() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entityIds?: string[]) =>
      api.post<RunEvalResponse>(
        workspacePath(workspaceId, "evaluations/sot"),
        entityIds ? { entityIds } : {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sot-evaluations"] });
    },
  });
}
