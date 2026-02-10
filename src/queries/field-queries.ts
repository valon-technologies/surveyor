import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { Field } from "@/types/field";

export function useUpdateField() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "fields");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch<Field>(`${basePath}/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
