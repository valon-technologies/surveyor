/**
 * Source matching engine — compares generated source references against
 * SOT (Source of Truth) ground truth.
 *
 * Ported from mapping-engine's transform_evaluator.py:_programmatic_source_match().
 */

export type SourceMatchType =
  | "EXACT"
  | "SUBSET"
  | "SUPERSET"
  | "OVERLAP"
  | "DISJOINT"
  | "NO_GEN"
  | "BOTH_NULL"
  | "SOT_NULL"
  | "NO_SOT";

export interface FieldSourceMatch {
  field: string;
  matchType: SourceMatchType;
  score: number;            // 1.0, 0.5, 0.25, 0.0
  genSources: string[];     // what Surveyor generated
  sotSources: string[];     // ground truth
  // Transform eval (populated when includeTransform is true)
  transformMatch?: import("./transform-evaluator").TransformMatchType;
  transformSimilarity?: number;
  transformExplanation?: string;
  sotTransformSummary?: string;
  genTransformSummary?: string;
}

// Table name variants that should normalize to the same canonical name
const TABLE_NAME_CANONICAL: Record<string, string> = {
  EventDate: "EventDates",
  MilitaryRelief: "MilitaryReliefHistory",
};

/**
 * Normalize a Table.Field source reference for comparison.
 * Handles case variations and known table name aliases.
 */
function normalizeSource(source: string): string {
  if (!source.includes(".")) return source;
  let [table, field] = source.split(".", 2);
  // Apply canonical table name mappings
  table = TABLE_NAME_CANONICAL[table] ?? table;
  return `${table}.${field}`;
}

function normalizeSourceSet(sources: string[]): Set<string> {
  return new Set(sources.map(normalizeSource));
}

// Score mapping for match types
const MATCH_SCORES: Record<SourceMatchType, number> = {
  EXACT: 1.0,
  BOTH_NULL: 1.0,
  SUBSET: 0.5,
  SUPERSET: 0.5,
  OVERLAP: 0.25,
  DISJOINT: 0.0,
  NO_GEN: 0.0,
  SOT_NULL: 0.0,  // excluded from scoring
  NO_SOT: 0.0,    // excluded from scoring
};

/**
 * Compare a single field's generated sources against SOT sources.
 */
export function matchSources(
  genSources: string[],
  sotSources: string[],
  fieldInSot: boolean = true,
): { matchType: SourceMatchType; score: number } {
  const genSet = normalizeSourceSet(genSources.filter((s) => s.includes(".")));
  const sotSet = normalizeSourceSet(sotSources.filter((s) => s.includes(".")));

  let matchType: SourceMatchType;

  if (genSet.size === 0 && sotSet.size === 0) {
    matchType = fieldInSot ? "BOTH_NULL" : "NO_SOT";
  } else if (sotSet.size === 0) {
    matchType = fieldInSot ? "SOT_NULL" : "NO_SOT";
  } else if (genSet.size === 0) {
    matchType = "NO_GEN";
  } else if (setsEqual(genSet, sotSet)) {
    matchType = "EXACT";
  } else if (isSubset(genSet, sotSet)) {
    matchType = "SUBSET";
  } else if (isSuperset(genSet, sotSet)) {
    matchType = "SUPERSET";
  } else if (hasOverlap(genSet, sotSet)) {
    matchType = "OVERLAP";
  } else {
    matchType = "DISJOINT";
  }

  return { matchType, score: MATCH_SCORES[matchType] };
}

// Set utilities
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size >= b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function isSuperset(a: Set<string>, b: Set<string>): boolean {
  return isSubset(b, a);
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

/**
 * Whether a match type should be included in accuracy scoring.
 * NO_SOT and SOT_NULL are excluded (no ground truth to compare against).
 */
export function isScorable(matchType: SourceMatchType): boolean {
  return matchType !== "NO_SOT" && matchType !== "SOT_NULL";
}

// ─── Transform Capping ─────────────────────────────────────

import type { TransformMatchType } from "./transform-evaluator";

/**
 * Cap for transform_match based on source match quality.
 * When source is wrong, transform can't be better than a threshold.
 */
const TRANSFORM_CAP: Record<SourceMatchType, TransformMatchType | null> = {
  EXACT: null,        // no cap
  SUBSET: "PARTIAL",  // cap to PARTIAL max
  SUPERSET: "PARTIAL",
  OVERLAP: "PARTIAL",
  DISJOINT: "WRONG",  // force to WRONG
  NO_GEN: null,
  BOTH_NULL: null,
  SOT_NULL: "WRONG",
  NO_SOT: null,
};

const TRANSFORM_RANK: Record<TransformMatchType, number> = {
  "N/A": 0,
  WRONG: 1,
  PARTIAL: 2,
  MATCH: 3,
};

/**
 * Apply source-based capping to a transform match result.
 * Returns the capped transform match and similarity.
 */
export function capTransformMatch(
  sourceMatch: SourceMatchType,
  transformMatch: TransformMatchType,
  similarity: number,
): { transformMatch: TransformMatchType; similarity: number } {
  const cap = TRANSFORM_CAP[sourceMatch];
  if (!cap) return { transformMatch, similarity };

  const capRank = TRANSFORM_RANK[cap];
  const matchRank = TRANSFORM_RANK[transformMatch];

  if (matchRank > capRank) {
    const cappedSimilarity =
      cap === "WRONG" ? Math.min(similarity, 0.25) :
      cap === "PARTIAL" ? Math.min(similarity, 0.5) :
      similarity;
    return { transformMatch: cap, similarity: cappedSimilarity };
  }

  return { transformMatch, similarity };
}
