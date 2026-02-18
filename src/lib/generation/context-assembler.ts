import { db } from "@/lib/db";
import { skill, skillContext, context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { estimateTokens } from "@/lib/llm/token-counter";
import { getCachedContext, setCachedContext } from "./context-cache";

export interface AssembledContext {
  skillsUsed: { id: string; name: string }[];
  primaryContexts: { id: string; name: string; content: string; tokenCount: number }[];
  referenceContexts: { id: string; name: string; content: string; tokenCount: number }[];
  supplementaryContexts: { id: string; name: string; content: string; tokenCount: number }[];
  totalTokens: number;
}

interface MatchedSkill {
  id: string;
  name: string;
  applicability: {
    entityPatterns?: string[];
    fieldPatterns?: string[];
    dataTypes?: string[];
    subcategories?: string[];
  } | null;
}

/**
 * Match active skills against entity/field/dataType criteria.
 * Extracted from the skills/match API route for reuse in generation.
 */
export function matchSkills(
  workspaceId: string,
  entityName: string,
  fieldName?: string,
  dataType?: string
): MatchedSkill[] {
  const entityLower = entityName.toLowerCase();
  const fieldLower = fieldName?.toLowerCase() || "";
  const dataUpper = dataType?.toUpperCase() || "";

  const skills = db
    .select()
    .from(skill)
    .where(and(eq(skill.workspaceId, workspaceId), eq(skill.isActive, true)))
    .all();

  return skills.filter((s) => {
    const app = s.applicability as MatchedSkill["applicability"];
    if (!app) return false;

    let matches = false;

    if (app.entityPatterns?.length && entityLower) {
      matches = matches || app.entityPatterns.some((p) =>
        entityLower.includes(p.toLowerCase())
      );
    }

    if (app.fieldPatterns?.length && fieldLower) {
      matches = matches || app.fieldPatterns.some((p) =>
        fieldLower.includes(p.toLowerCase())
      );
    }

    if (app.dataTypes?.length && dataUpper) {
      matches = matches || app.dataTypes.some((dt) =>
        dt.toUpperCase() === dataUpper
      );
    }

    return matches;
  });
}

/**
 * Assemble all context content from matched skills, grouped by role,
 * trimmed to fit within the given token budget.
 */
export function assembleContext(
  workspaceId: string,
  entityName: string,
  tokenBudget: number
): AssembledContext {
  const cached = getCachedContext(workspaceId, entityName, tokenBudget);
  if (cached) return cached;

  const matched = matchSkills(workspaceId, entityName);

  const primaryContexts: AssembledContext["primaryContexts"] = [];
  const referenceContexts: AssembledContext["referenceContexts"] = [];
  const supplementaryContexts: AssembledContext["supplementaryContexts"] = [];
  const seenContextIds = new Set<string>();

  for (const s of matched) {
    const scs = db
      .select()
      .from(skillContext)
      .where(eq(skillContext.skillId, s.id))
      .orderBy(skillContext.sortOrder)
      .all();

    for (const sc of scs) {
      if (seenContextIds.has(sc.contextId)) continue;
      seenContextIds.add(sc.contextId);

      const ctx = db
        .select()
        .from(context)
        .where(eq(context.id, sc.contextId))
        .get();

      if (!ctx || !ctx.isActive || !ctx.content) continue;

      const tokenCount = ctx.tokenCount || estimateTokens(ctx.content);
      const entry = { id: ctx.id, name: ctx.name, content: ctx.content, tokenCount };

      if (sc.role === "primary") primaryContexts.push(entry);
      else if (sc.role === "reference") referenceContexts.push(entry);
      else supplementaryContexts.push(entry);
    }
  }

  // Trim to fit budget: primary never dropped, then reference, then supplementary
  let totalTokens = 0;

  // Primary always included
  for (const c of primaryContexts) totalTokens += c.tokenCount;

  // Add reference until budget
  const keptReference: typeof referenceContexts = [];
  for (const c of referenceContexts) {
    if (totalTokens + c.tokenCount <= tokenBudget) {
      keptReference.push(c);
      totalTokens += c.tokenCount;
    }
  }

  // Add supplementary until budget
  const keptSupplementary: typeof supplementaryContexts = [];
  for (const c of supplementaryContexts) {
    if (totalTokens + c.tokenCount <= tokenBudget) {
      keptSupplementary.push(c);
      totalTokens += c.tokenCount;
    }
  }

  const result: AssembledContext = {
    skillsUsed: matched.map((s) => ({ id: s.id, name: s.name })),
    primaryContexts,
    referenceContexts: keptReference,
    supplementaryContexts: keptSupplementary,
    totalTokens,
  };

  setCachedContext(workspaceId, entityName, tokenBudget, result);

  return result;
}
