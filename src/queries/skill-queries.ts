import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { DEFAULT_WORKSPACE_ID } from "@/lib/constants";
import type {
  Skill,
  SkillWithCount,
  SkillWithContexts,
  SkillCreateInput,
  SkillUpdateInput,
  SkillContextInput,
  SkillContextWithDetail,
} from "@/types/skill";

const basePath = workspacePath(DEFAULT_WORKSPACE_ID, "skills");

export function useSkills() {
  return useQuery({
    queryKey: ["skills", DEFAULT_WORKSPACE_ID],
    queryFn: () => api.get<SkillWithCount[]>(basePath),
  });
}

export function useSkill(id: string | undefined) {
  return useQuery({
    queryKey: ["skills", DEFAULT_WORKSPACE_ID, id],
    queryFn: () => api.get<SkillWithContexts>(`${basePath}/${id}`),
    enabled: !!id,
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillCreateInput) => api.post<SkillWithCount>(basePath, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useUpdateSkill() {
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${basePath}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useSkillContexts(skillId: string | undefined) {
  return useQuery({
    queryKey: ["skills", DEFAULT_WORKSPACE_ID, skillId, "contexts"],
    queryFn: () =>
      api.get<SkillContextWithDetail[]>(`${basePath}/${skillId}/contexts`),
    enabled: !!skillId,
  });
}

export function useAddSkillContext() {
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, scId }: { skillId: string; scId: string }) =>
      api.delete(`${basePath}/${skillId}/contexts/${scId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useMatchingSkills(
  entityName?: string,
  fieldName?: string,
  dataType?: string
) {
  return useQuery({
    queryKey: [
      "skills",
      DEFAULT_WORKSPACE_ID,
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
