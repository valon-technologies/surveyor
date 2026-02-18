import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { SimilarityResult, RippleProposal } from "@/types/ripple";

interface SimilarResponse {
  exemplar: {
    id: string;
    targetFieldName: string;
    entityName: string;
    sourceEntityName: string | null;
    mappingType: string | null;
  };
  similar: SimilarityResult[];
}

interface GenerateResponse {
  proposals: RippleProposal[];
  errors: Array<{ entityId: string; entityName: string; error: string }>;
}

interface ApplyResponse {
  applied: number;
  mappingIds: string[];
}

export function useRippleSimilar(mappingId: string | null) {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: ["ripple-similar", workspaceId, mappingId],
    queryFn: () =>
      api.get<SimilarResponse>(
        workspacePath(workspaceId, `mappings/${mappingId}/ripple/similar`)
      ),
    enabled: !!mappingId,
  });
}

export function useRippleGenerate() {
  const { workspaceId } = useWorkspace();

  return useMutation({
    mutationFn: ({
      mappingId,
      targetMappingIds,
      userInstruction,
    }: {
      mappingId: string;
      targetMappingIds: string[];
      userInstruction?: string;
    }) =>
      api.post<GenerateResponse>(
        workspacePath(workspaceId, `mappings/${mappingId}/ripple/generate`),
        { targetMappingIds, userInstruction }
      ),
  });
}

export function useRippleApply() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      mappingId,
      proposals,
    }: {
      mappingId: string;
      proposals: RippleProposal[];
    }) =>
      api.post<ApplyResponse>(
        workspacePath(workspaceId, `mappings/${mappingId}/ripple/apply`),
        { proposals }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
