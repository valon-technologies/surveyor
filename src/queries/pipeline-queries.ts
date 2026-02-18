import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { EntityPipelineWithColumns } from "@/types/pipeline";

export function useEntityPipeline(entityId: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "entities");
  return useQuery({
    queryKey: ["pipeline", workspaceId, entityId],
    queryFn: () => api.get<EntityPipelineWithColumns>(`${basePath}/${entityId}/pipeline`),
    enabled: !!entityId,
    retry: false,
  });
}

export function useExportPipelineYaml(entityId: string | undefined) {
  const { data: pipeline } = useEntityPipeline(entityId);

  return {
    pipeline,
    exportYaml: () => {
      if (!pipeline?.yamlSpec) return;
      const blob = new Blob([pipeline.yamlSpec], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pipeline.tableName}_v${pipeline.version}.yaml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}
