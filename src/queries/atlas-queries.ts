import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { QueryResult } from "@/lib/bigquery/gestalt-client";

interface ComponentResult {
  alias: string;
  tableName: string;
  sql: string;
  result: QueryResult;
  error?: string;
}

export interface FlatSampleData {
  structureType: "flat";
  entityName: string;
  sql: string;
  result: QueryResult;
  columns: string[];
}

export interface AssemblySampleData {
  structureType: "assembly";
  entityName: string;
  columns: string[];
  components: ComponentResult[];
}

export type SampleData = FlatSampleData | AssemblySampleData;

export function useEntitySampleData(entityId: string | null) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "entities");
  return useQuery<SampleData>({
    queryKey: ["sample-data", workspaceId, entityId],
    queryFn: () => api.get<SampleData>(`${basePath}/${entityId}/sample-data`),
    enabled: !!entityId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
