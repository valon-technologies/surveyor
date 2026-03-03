import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type {
  SotEntityMapping,
  SotEntitySummary,
} from "@/lib/sot/yaml-parser";

interface EnrichedSotEntitySummary extends SotEntitySummary {
  hasOnboardingConfig: boolean;
  onboardingTasks: string[];
}

interface SotMappingListResponse {
  entities: EnrichedSotEntitySummary[];
  stats: {
    m1Count: number;
    m2Count: number;
    totalFields: number;
    onboardedCount: number;
  };
}

interface SotMappingDetailResponse extends SotEntityMapping {
  onboardingTasks: string[];
  onboardingDetail?: {
    taskType: string;
    role: "primary" | "dependency";
    consumedFields: string[];
  }[];
}

export function useSotMappingList() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["sot-mappings", workspaceId],
    queryFn: () =>
      api.get<SotMappingListResponse>(
        workspacePath(workspaceId, "sot-mappings")
      ),
  });
}

export function useSotMappingDetail(
  entityName: string | null,
  milestone: "m1" | "m2" = "m1"
) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["sot-mapping-detail", workspaceId, entityName, milestone],
    queryFn: () =>
      api.get<SotMappingDetailResponse>(
        workspacePath(workspaceId, `sot-mappings/${entityName}`),
        { milestone }
      ),
    enabled: !!entityName,
  });
}
