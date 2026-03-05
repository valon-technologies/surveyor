import { db } from "@/lib/db";
import { fieldMapping, mappingContext, field, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { SimilarityResult, SimilaritySignals } from "@/types/ripple";

interface FindSimilarOptions {
  minScore?: number;
  maxResults?: number;
}

const WEIGHTS = {
  sourceMatch: 0.5,
  transformPattern: 0.3,
  contextOverlap: 0.2,
};

/**
 * Normalize a transform expression for pattern comparison.
 * Replaces specific field/table names with `?` placeholders,
 * lowercases, and strips extra whitespace.
 */
function normalizeTransform(transform: string | null): string | null {
  if (!transform) return null;
  return transform
    .toLowerCase()
    .replace(/[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*/g, "?.?")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the SQL function family from a transform expression.
 * e.g. "CAST(x AS DATE)" → "cast", "COALESCE(a, b)" → "coalesce"
 */
function extractFunctionFamily(transform: string | null): string | null {
  if (!transform) return null;
  const match = transform.match(/^(\w+)\s*\(/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Compute Jaccard similarity between two sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Build a human-readable reason string from the top scoring signals.
 */
function buildReason(signals: SimilaritySignals, exemplar: { sourceEntityName: string | null; mappingType: string | null }): string {
  const parts: string[] = [];

  if (signals.sourceMatch >= 0.8) {
    parts.push(`same source${exemplar.sourceEntityName ? ` (${exemplar.sourceEntityName})` : ""}`);
  } else if (signals.sourceMatch > 0) {
    parts.push("related source entity");
  }

  if (signals.transformPattern >= 0.8) {
    parts.push("same transform pattern");
  } else if (signals.transformPattern >= 0.5) {
    parts.push("similar transform function");
  } else if (signals.transformPattern > 0) {
    parts.push(`same mapping type (${exemplar.mappingType || "unknown"})`);
  }

  if (signals.contextOverlap > 0.5) {
    parts.push("high context overlap");
  } else if (signals.contextOverlap > 0) {
    parts.push("shared context");
  }

  return parts.length > 0 ? parts.join(", ") : "pattern similarity";
}

/**
 * Find mappings similar to the given exemplar mapping.
 * Uses three weighted signals: source match, transform pattern, and context overlap.
 */
export async function findSimilarMappings(
  workspaceId: string,
  exemplarMappingId: string,
  options: FindSimilarOptions = {}
): Promise<{ exemplar: { id: string; targetFieldName: string; entityName: string; sourceEntityName: string | null; mappingType: string | null }; similar: SimilarityResult[] }> {
  const { minScore = 0.3, maxResults = 20 } = options;

  // Load exemplar mapping
  const exemplarMapping = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, exemplarMappingId), eq(fieldMapping.workspaceId, workspaceId)))
    )[0];

  if (!exemplarMapping) {
    throw new Error("Exemplar mapping not found");
  }

  // Load exemplar field and entity names
  const [exemplarField] = await db.select().from(field).where(eq(field.id, exemplarMapping.targetFieldId)).limit(1);
  const exemplarEntity = exemplarField
    ? (await db.select().from(entity).where(eq(entity.id, exemplarField.entityId)).limit(1))[0]
    : null;

  let exemplarSourceEntityName: string | null = null;
  if (exemplarMapping.sourceEntityId) {
    const [se] = await db.select().from(entity).where(eq(entity.id, exemplarMapping.sourceEntityId)).limit(1);
    exemplarSourceEntityName = se?.displayName || se?.name || null;
  }

  const exemplarInfo = {
    id: exemplarMappingId,
    targetFieldName: exemplarField?.displayName || exemplarField?.name || "unknown",
    entityName: exemplarEntity?.displayName || exemplarEntity?.name || "unknown",
    sourceEntityName: exemplarSourceEntityName,
    mappingType: exemplarMapping.mappingType,
  };

  // Load all candidate mappings: isLatest=true, not accepted, not excluded, not the exemplar
  const candidates = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.workspaceId, workspaceId), eq(fieldMapping.isLatest, true)))
    )
    .filter(
      (m) =>
        m.id !== exemplarMappingId &&
        m.status !== "accepted" &&
        m.status !== "excluded"
    );

  if (candidates.length === 0) {
    return { exemplar: exemplarInfo, similar: [] };
  }

  // Batch-load all mapping contexts for the workspace
  const allMappingContexts = await db
    .select()
    .from(mappingContext)
    ;

  // Build context sets per mapping
  const contextSetsMap = new Map<string, Set<string>>();
  for (const mc of allMappingContexts) {
    if (!mc.contextId) continue;
    let set = contextSetsMap.get(mc.fieldMappingId);
    if (!set) {
      set = new Set();
      contextSetsMap.set(mc.fieldMappingId, set);
    }
    set.add(mc.contextId);
  }

  const exemplarContexts = contextSetsMap.get(exemplarMappingId) || new Set<string>();
  const exemplarNormalizedTransform = normalizeTransform(exemplarMapping.transform);
  const exemplarFunctionFamily = extractFunctionFamily(exemplarMapping.transform);

  // Score each candidate
  const scored: Array<{ mapping: typeof candidates[0]; score: number; signals: SimilaritySignals }> = [];

  for (const candidate of candidates) {
    // 1. Source match signal
    let sourceMatch = 0;
    if (exemplarMapping.sourceFieldId && candidate.sourceFieldId === exemplarMapping.sourceFieldId) {
      sourceMatch = 1.0;
    } else if (exemplarMapping.sourceEntityId && candidate.sourceEntityId === exemplarMapping.sourceEntityId) {
      sourceMatch = 0.8;
    }

    // 2. Transform pattern signal
    let transformPattern = 0;
    const candidateNormalized = normalizeTransform(candidate.transform);
    const candidateFamily = extractFunctionFamily(candidate.transform);

    if (exemplarNormalizedTransform && candidateNormalized && exemplarNormalizedTransform === candidateNormalized) {
      transformPattern = 1.0;
    } else if (exemplarFunctionFamily && candidateFamily && exemplarFunctionFamily === candidateFamily) {
      transformPattern = 0.6;
    } else if (exemplarMapping.mappingType && candidate.mappingType === exemplarMapping.mappingType) {
      transformPattern = 0.3;
    }

    // 3. Context overlap signal
    const candidateContexts = contextSetsMap.get(candidate.id) || new Set<string>();
    const contextOverlap = jaccard(exemplarContexts, candidateContexts);

    // Weighted score
    const score =
      WEIGHTS.sourceMatch * sourceMatch +
      WEIGHTS.transformPattern * transformPattern +
      WEIGHTS.contextOverlap * contextOverlap;

    if (score >= minScore) {
      scored.push({ mapping: candidate, score, signals: { sourceMatch, transformPattern, contextOverlap } });
    }
  }

  // Sort by score descending, take top maxResults
  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, maxResults);

  // Resolve field and entity names for results
  const results: SimilarityResult[] = [];

  for (const { mapping, score, signals } of topResults) {
    const [targetF] = await db.select().from(field).where(eq(field.id, mapping.targetFieldId)).limit(1);
    if (!targetF) continue;

    const [targetE] = await db.select().from(entity).where(eq(entity.id, targetF.entityId)).limit(1);
    if (!targetE) continue;

    results.push({
      mappingId: mapping.id,
      targetFieldId: mapping.targetFieldId,
      targetFieldName: targetF.displayName || targetF.name,
      entityId: targetE.id,
      entityName: targetE.displayName || targetE.name,
      score: Math.round(score * 100) / 100,
      signals,
      reason: buildReason(signals, exemplarInfo),
    });
  }

  return { exemplar: exemplarInfo, similar: results };
}
