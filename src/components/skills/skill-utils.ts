import type { SkillContextRole } from "@/lib/constants";
import type { SkillContextWithDetail } from "@/types/skill";

export function groupByRole(contexts: SkillContextWithDetail[]) {
  const groups: Record<SkillContextRole, SkillContextWithDetail[]> = {
    primary: [],
    reference: [],
    supplementary: [],
  };
  for (const sc of contexts) {
    groups[sc.role]?.push(sc);
  }
  return groups;
}

export function formatTokens(count: number | null): string {
  if (!count) return "?";
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}
