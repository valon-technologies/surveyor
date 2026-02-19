import { db } from "@/lib/db";
import { skill, skillContext, context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { estimateTokens } from "@/lib/llm/token-counter";
import { getCachedContext, setCachedContext } from "./context-cache";
import { searchContextsFts } from "@/lib/rag/fts5-search";
import { SYSTEM_EMBEDDED_NAMES, RAG_ONLY_NAMES } from "./system-context";

const SM_TABLE_PREFIX = "ServiceMac > Tables > ";
const SM_ENUM_PREFIX = "ServiceMac > Enums > ";
const SM_ENUM_SUFFIX = " ENUMS";

/**
 * Normalize a ServiceMac name for matching: lowercase + strip spaces.
 * For enum keys (concatenated CamelCase like "STOPSFLAGSANDINDICATORS"),
 * also strips common conjunctions ("and", "the") that may be embedded.
 */
function normalizeSmName(name: string, stripConjunctions = false): string {
  let result = name.toLowerCase().replace(/\s+/g, "");
  if (stripConjunctions) {
    // Only strip "and"/"the" — safe for concatenated table names.
    // "of" skipped to avoid mangling names like "Payoff".
    result = result.replace(/and|the/g, "");
  }
  return result;
}

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
 *
 * When `query` is provided, FTS5 results are appended as supplementary
 * contexts after skill-based assembly (skipping already-seen IDs).
 *
 * When `sourceEntityNames` is provided, enum contexts for those source
 * tables are auto-included even if the tables aren't in the skill's
 * primary contexts. This ensures enum lookups are available for all
 * source tables in the prompt, not just those explicitly linked by skills.
 */
export function assembleContext(
  workspaceId: string,
  entityName: string,
  tokenBudget: number,
  query?: string,
  sourceEntityNames?: string[],
): AssembledContext {
  // Skip cache when sourceEntityNames are provided — the cache key doesn't
  // include them, so a cached result might be missing enum contexts.
  if (!sourceEntityNames?.length) {
    const cached = getCachedContext(workspaceId, entityName, tokenBudget, query);
    if (cached) return cached;
  }

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

      // Skip contexts that are now embedded in system message or RAG-only
      if (SYSTEM_EMBEDDED_NAMES.has(ctx.name) || RAG_ONLY_NAMES.has(ctx.name)) continue;

      const tokenCount = ctx.tokenCount || estimateTokens(ctx.content);
      const entry = { id: ctx.id, name: ctx.name, content: ctx.content, tokenCount };

      if (sc.role === "primary") primaryContexts.push(entry);
      else if (sc.role === "reference") referenceContexts.push(entry);
      else supplementaryContexts.push(entry);
    }
  }

  // Auto-include enum_map contexts for source tables in primary contexts
  // AND source tables in the prompt's source schema. This ensures enum
  // lookups are available for all source tables the LLM will reference,
  // not just those explicitly linked by skills.
  //
  // Matching uses three strategies (in order):
  //  1. metadata.source_tables — explicit table-to-enum mapping (handles
  //     cross-references like BorrowerDemographics → FAIRLENDING ENUMS)
  //  2. Normalized name match — strips spaces/case (handles most cases)
  //  3. Conjunction-stripped match — also strips "and"/"the" (handles
  //     StopsFlagsAndIndicators → Stops Flags Indicators)
  const includedTableNames = primaryContexts
    .filter((c) => c.name.startsWith(SM_TABLE_PREFIX))
    .map((c) => c.name.slice(SM_TABLE_PREFIX.length));

  // Also include source entity names from the prompt's source schema
  if (sourceEntityNames?.length) {
    for (const name of sourceEntityNames) {
      if (!includedTableNames.some((t) => normalizeSmName(t) === normalizeSmName(name))) {
        includedTableNames.push(name);
      }
    }
  }

  const includedTableKeys = new Set(
    includedTableNames.map((n) => normalizeSmName(n))
  );

  if (includedTableKeys.size > 0) {
    const enumContexts = db
      .select()
      .from(context)
      .where(and(eq(context.subcategory, "enum_map"), eq(context.isActive, true)))
      .all();

    for (const ec of enumContexts) {
      if (seenContextIds.has(ec.id) || !ec.content) continue;

      let matched = false;

      // Strategy 1: metadata.source_tables (explicit mapping)
      if (ec.metadata) {
        try {
          const meta = typeof ec.metadata === "string"
            ? JSON.parse(ec.metadata)
            : ec.metadata;
          const sourceTables: string[] = meta?.source_tables || [];
          matched = sourceTables.some((st) => includedTableKeys.has(normalizeSmName(st)));
        } catch { /* ignore malformed metadata */ }
      }

      // Strategy 2 & 3: name-based matching
      if (!matched) {
        const rawEnumKey = ec.name
          .replace(SM_ENUM_PREFIX, "")
          .replace(SM_ENUM_SUFFIX, "");
        const enumKey = normalizeSmName(rawEnumKey);
        const enumKeyStripped = normalizeSmName(rawEnumKey, true);
        matched = includedTableKeys.has(enumKey) || includedTableKeys.has(enumKeyStripped);
      }

      if (matched) {
        seenContextIds.add(ec.id);
        const tokenCount = ec.tokenCount || estimateTokens(ec.content);
        referenceContexts.push({
          id: ec.id,
          name: ec.name,
          content: ec.content,
          tokenCount,
        });
      }
    }
  }

  // FTS5 query-aware retrieval: add relevant docs beyond skill matching
  if (query) {
    const ftsResults = searchContextsFts(workspaceId, query, 10);
    for (const fts of ftsResults) {
      if (seenContextIds.has(fts.contextId)) continue;
      seenContextIds.add(fts.contextId);

      const ctx = db
        .select()
        .from(context)
        .where(eq(context.id, fts.contextId))
        .get();

      if (!ctx || !ctx.isActive || !ctx.content) continue;

      const tokenCount = ctx.tokenCount || estimateTokens(ctx.content);
      supplementaryContexts.push({
        id: ctx.id,
        name: ctx.name,
        content: ctx.content,
        tokenCount,
      });
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

  setCachedContext(workspaceId, entityName, tokenBudget, result, query);

  return result;
}
