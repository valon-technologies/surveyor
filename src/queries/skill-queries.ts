import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type {
  Skill,
  SkillWithCount,
  SkillWithContexts,
  SkillCreateInput,
  SkillUpdateInput,
  SkillContextInput,
  SkillContextWithDetail,
  AssemblySimulationResult,
} from "@/types/skill";

export function useSkills() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  return useQuery({
    queryKey: ["skills", workspaceId],
    queryFn: () => api.get<SkillWithCount[]>(basePath),
  });
}

export function useSkill(id: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  return useQuery({
    queryKey: ["skills", workspaceId, id],
    queryFn: () => api.get<SkillWithContexts>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useCreateSkill() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillCreateInput) => api.post<SkillWithCount>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useUpdateSkill() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & SkillUpdateInput) =>
      api.patch<Skill>(`${basePath}/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useDeleteSkill() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${basePath}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useSkillContexts(skillId: string | undefined) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  return useQuery({
    queryKey: ["skills", workspaceId, skillId, "contexts"],
    queryFn: () =>
      api.get<SkillContextWithDetail[]>(`${basePath}/${skillId}/contexts`),
    enabled: !!skillId,
  });
}

export function useAddSkillContext() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      ...data
    }: { skillId: string } & SkillContextInput) =>
      api.post<SkillContextWithDetail>(
        `${basePath}/${skillId}/contexts`,
        data
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useRemoveSkillContext() {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, scId }: { skillId: string; scId: string }) =>
      api.delete(`${basePath}/${skillId}/contexts/${scId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useAssemblySimulation(
  entityName?: string,
  tokenBudget: number = 160_000
) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  return useQuery({
    queryKey: ["skills", workspaceId, "simulate", entityName, tokenBudget],
    queryFn: () =>
      api.get<AssemblySimulationResult>(`${basePath}/simulate`, {
        entityName,
        tokenBudget,
      }),
    enabled: !!entityName?.trim(),
  });
}

export function useMatchingSkills(
  entityName?: string,
  fieldName?: string,
  dataType?: string
) {
  const { workspaceId } = useWorkspace();
  const basePath = workspacePath(workspaceId, "skills");
  return useQuery({
    queryKey: [
      "skills",
      workspaceId,
      "match",
      entityName,
      fieldName,
      dataType,
    ],
    queryFn: () =>
      api.get<SkillWithContexts[]>(`${basePath}/match`, {
        entityName,
        fieldName,
        dataType,
      }),
    enabled: !!(entityName || fieldName || dataType),
  });
}
