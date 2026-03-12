import { db } from "@/lib/db";
import { skill, skillContext, context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { estimateTokens } from "@/lib/llm/token-counter";
import { getCachedContext, setCachedContext } from "./context-cache";
import { searchContextsFts } from "@/lib/rag/fts5-search";
import { SYSTEM_EMBEDDED_NAMES, RAG_ONLY_NAMES } from "./system-context";
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";

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
export async function matchSkills(
  workspaceId: string,
  entityName: string,
  fieldName?: string,
  dataType?: string
): Promise<MatchedSkill[]> {
  const entityLower = entityName.toLowerCase();
  const fieldLower = fieldName?.toLowerCase() || "";
  const dataUpper = dataType?.toUpperCase() || "";

  const skills = await db
    .select()
    .from(skill)
    .where(and(eq(skill.workspaceId, workspaceId), eq(skill.isActive, true)))
    ;

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
export async function assembleContext(
  workspaceId: string,
  entityName: string,
  tokenBudget: number,
  query?: string,
  sourceEntityNames?: string[],
  excludeEntityName?: string,
  entityId?: string,
): Promise<AssembledContext> {
  // Skip cache when sourceEntityNames are provided — the cache key doesn't
  // include them, so a cached result might be missing enum contexts.
  if (!sourceEntityNames?.length) {
    const cached = getCachedContext(workspaceId, entityName, tokenBudget, query, entityId);
    if (cached) return cached;
  }

  const matched = await matchSkills(workspaceId, entityName);

  const primaryContexts: AssembledContext["primaryContexts"] = [];
  const referenceContexts: AssembledContext["referenceContexts"] = [];
  const supplementaryContexts: AssembledContext["supplementaryContexts"] = [];
  const seenContextIds = new Set<string>();

  for (const s of matched) {
    const scs = await db
      .select()
      .from(skillContext)
      .where(eq(skillContext.skillId, s.id))
      .orderBy(skillContext.sortOrder)
      ;

    for (const sc of scs) {
      if (seenContextIds.has(sc.contextId)) continue;
      seenContextIds.add(sc.contextId);

      const ctx = (await db
        .select()
        .from(context)
        .where(eq(context.id, sc.contextId))
        )[0];

      if (!ctx || !ctx.isActive || !ctx.content) continue;

      // Skip contexts that are now embedded in system message or RAG-only
      if (SYSTEM_EMBEDDED_NAMES.has(ctx.name) || RAG_ONLY_NAMES.has(ctx.name)) continue;

      // Large docs (>10K tokens) are RAG-only — retrieved via FTS5 on demand
      const RAG_ONLY_THRESHOLD = 10_000;
      const docTokens = ctx.tokenCount || estimateTokens(ctx.content);
      if (docTokens > RAG_ONLY_THRESHOLD) continue;

      // Exclude the current entity's SOT to prevent cheating during eval
      if (excludeEntityName && ctx.name === `SOT > ${excludeEntityName} (M1)`) continue;

      // EXCLUDE_SOT=1 suppresses all SOT contexts from generation
      if (process.env.EXCLUDE_SOT === "1" && ctx.name.startsWith("SOT > ")) continue;

      const tokenCount = ctx.tokenCount || estimateTokens(ctx.content);
      const entry = { id: ctx.id, name: ctx.name, content: ctx.content, tokenCount };

      if (sc.role === "primary") primaryContexts.push(entry);
      else if (sc.role === "reference") referenceContexts.push(entry);
      else supplementaryContexts.push(entry);
    }
  }

  // Direct inclusion 1: Entity Knowledge doc for this specific entity (bypasses skill routing).
  // This is the fast-loop feedback path — corrections and resolved questions flow here.
  if (entityId) {
    const ekDocs = await db
      .select()
      .from(context)
      .where(
        and(
          eq(context.workspaceId, workspaceId),
          eq(context.subcategory, "entity_knowledge"),
          eq(context.entityId, entityId),
          eq(context.isActive, true),
        ),
      )
      ;

    for (const doc of ekDocs) {
      if (seenContextIds.has(doc.id) || !doc.content) continue;
      seenContextIds.add(doc.id);
      const tokenCount = doc.tokenCount || estimateTokens(doc.content);
      // EK is mandatory — promote to primary so it's never dropped under token budget
      primaryContexts.push({ id: doc.id, name: doc.name, content: doc.content, tokenCount });
    }
  }

  // Direct inclusion 2: Foundational docs (distilled learnings, mortgage domain) for all entities.
  // These don't need skill routing — they're always relevant.
  const foundationalDocs = await db
    .select()
    .from(context)
    .where(
      and(
        eq(context.workspaceId, workspaceId),
        eq(context.category, "foundational"),
        eq(context.isActive, true),
      ),
    )
    ;

  for (const doc of foundationalDocs) {
    if (seenContextIds.has(doc.id) || !doc.content) continue;
    if (SYSTEM_EMBEDDED_NAMES.has(doc.name) || RAG_ONLY_NAMES.has(doc.name)) continue;
    const tokenCount = doc.tokenCount || estimateTokens(doc.content);
    if (tokenCount > 10_000) continue; // Large docs are RAG-only
    seenContextIds.add(doc.id);
    supplementaryContexts.push({ id: doc.id, name: doc.name, content: doc.content, tokenCount });
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
    const enumContexts = await db
      .select()
      .from(context)
      .where(and(eq(context.subcategory, "enum_map"), eq(context.isActive, true)))
      ;

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
    const ftsResults = await searchContextsFts(workspaceId, query, 10);
    for (const fts of ftsResults) {
      if (seenContextIds.has(fts.contextId)) continue;
      seenContextIds.add(fts.contextId);

      const ctx = (await db
        .select()
        .from(context)
        .where(eq(context.id, fts.contextId))
        )[0];

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

  // Soft cap on primary context: EK corrections get priority, excess demoted to reference
  const PRIMARY_CONTEXT_CAP = 40_000;
  let primaryTokens = 0;
  const cappedPrimary: typeof primaryContexts = [];
  // Sort: EK docs first (subcategory check via name), then others
  const sortedPrimary = [...primaryContexts].sort((a, b) => {
    const aIsEk = a.name.startsWith("Entity Knowledge");
    const bIsEk = b.name.startsWith("Entity Knowledge");
    if (aIsEk && !bIsEk) return -1;
    if (!aIsEk && bIsEk) return 1;
    return 0;
  });
  for (const c of sortedPrimary) {
    if (primaryTokens + c.tokenCount <= PRIMARY_CONTEXT_CAP) {
      cappedPrimary.push(c);
      primaryTokens += c.tokenCount;
    } else {
      // Demote to reference tier
      referenceContexts.unshift(c);
    }
  }

  // Trim to fit budget: primary (capped) always included, then reference, then supplementary
  let totalTokens = 0;

  // Primary always included (after cap)
  for (const c of cappedPrimary) totalTokens += c.tokenCount;

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
    primaryContexts: cappedPrimary,
    referenceContexts: keptReference,
    supplementaryContexts: keptSupplementary,
    totalTokens,
  };

  // Emit context_assembled event for feedback trail
  if (entityId) {
    const ekContexts = referenceContexts.filter(
      (c) => c.name.startsWith("Entity Knowledge >")
    );
    emitFeedbackEvent({
      workspaceId,
      entityId,
      eventType: "context_assembled",
      payload: {
        entityKnowledgeIncluded: ekContexts.length > 0,
        ekTokens: ekContexts.reduce((sum, c) => sum + c.tokenCount, 0),
        totalContextTokens: totalTokens,
        skillCount: matched.length,
      },
    });
  }

  setCachedContext(workspaceId, entityName, tokenBudget, result, query, entityId);

  return result;
}
