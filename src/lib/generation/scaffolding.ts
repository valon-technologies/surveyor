/**
 * Entity scaffolding engine — pre-analyzes source-target relationships using
 * heuristics (+ optional lightweight LLM call) to guide mapping strategy.
 *
 * Replaces/augments the simple prefix-based classifyStructure() with:
 * 1. Source table relevance scoring by field overlap
 * 2. Discriminator column detection (name patterns: *Indicator, *Type, *Code)
 * 3. FK relationship detection across entities (*_id suffix matching)
 * 4. Topology classification: single_source | multi_source_same_type |
 *    multi_source_different_type | assembly
 * 5. Optional small LLM call (~2K tokens) for strategy synthesis
 */

import { db } from "@/lib/db";
import { entity, field, entityScaffold } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────

export type ScaffoldTopology =
  | "single_source"
  | "multi_source_same_type"
  | "multi_source_different_type"
  | "assembly";

export interface SourceTableAnalysis {
  name: string;
  relevanceScore: number; // 0-100
  matchedFields: number;
  role: "primary" | "secondary" | "lookup" | "irrelevant";
  discriminatorColumns?: { column: string; values: string[]; meaning: string }[];
  fkRelationships?: { column: string; referencesEntity: string }[];
}

export interface EntityScaffoldData {
  entityName: string;
  topology: ScaffoldTopology;
  sourceTables: SourceTableAnalysis[];
  assemblyComponents?: Record<string, unknown>[];
  strategyNotes: string;
  primarySources: string[];
  secondarySources: string[];
  excludedSources: string[];
}

// ── Abbreviation expansion for fuzzy field matching ──────────

const ABBREVIATION_MAP: Record<string, string> = {
  amt: "amount",
  dt: "date",
  num: "number",
  nbr: "number",
  no: "number",
  cd: "code",
  desc: "description",
  typ: "type",
  ind: "indicator",
  flg: "flag",
  pct: "percent",
  rt: "rate",
  bal: "balance",
  pmt: "payment",
  addr: "address",
  st: "state",
  cty: "county",
  cntry: "country",
  nm: "name",
  ln: "loan",
  acct: "account",
  inv: "investor",
  svc: "servicer",
  orig: "original",
  cur: "current",
  prev: "previous",
  eff: "effective",
  exp: "expiration",
  mtg: "mortgage",
  prop: "property",
  ins: "insurance",
  borr: "borrower",
  cob: "coborrower",
};

/**
 * Normalize a field name to a canonical form for comparison.
 * Handles: camelCase → words, snake_case → words, abbreviation expansion.
 */
function normalizeFieldName(name: string): string[] {
  // Split camelCase + snake_case + spaces
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[_\s-]+/g, "_")
    .toLowerCase()
    .split("_")
    .filter(Boolean);

  // Expand abbreviations
  return words.map((w) => ABBREVIATION_MAP[w] ?? w);
}

/**
 * Score how well a source field name matches a target field name.
 * Returns 0-100 where 100 is exact match.
 */
function scoreFieldMatch(targetName: string, sourceName: string): number {
  const targetWords = normalizeFieldName(targetName);
  const sourceWords = normalizeFieldName(sourceName);

  if (targetWords.join("_") === sourceWords.join("_")) return 100;

  // Jaccard similarity on normalized words
  const targetSet = new Set(targetWords);
  const sourceSet = new Set(sourceWords);
  const intersection = new Set([...targetSet].filter((w) => sourceSet.has(w)));

  if (intersection.size === 0) return 0;

  const union = new Set([...targetSet, ...sourceSet]);
  return Math.round((intersection.size / union.size) * 80); // max 80 for partial match
}

// ── Discriminator detection ──────────────────────────────────

const DISCRIMINATOR_PATTERNS = [
  /indicator$/i,
  /type$/i,
  /code$/i,
  /category$/i,
  /class$/i,
  /kind$/i,
  /flag$/i,
];

function isDiscriminatorColumn(fieldName: string): boolean {
  return DISCRIMINATOR_PATTERNS.some((p) => p.test(fieldName));
}

// ── FK detection ─────────────────────────────────────────────

function isFkColumn(fieldName: string): boolean {
  return /(_id|Id)$/.test(fieldName);
}

function extractReferencedEntity(fieldName: string): string | null {
  // "loan_id" → "loan", "BorrowerIndicatorId" → "borrower_indicator"
  const match = fieldName.match(/^(.+?)(_id|Id)$/);
  if (!match) return null;
  return match[1]
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

// ── Core analysis functions ──────────────────────────────────

/**
 * Score source tables by field overlap with target fields. Pure heuristic.
 */
export function analyzeSourceOverlap(
  targetFieldNames: string[],
  sourceEntities: { name: string; fields: { name: string; dataType: string | null }[] }[],
): SourceTableAnalysis[] {
  const results: SourceTableAnalysis[] = [];

  for (const source of sourceEntities) {
    let totalScore = 0;
    let matchedFields = 0;
    const discriminatorColumns: SourceTableAnalysis["discriminatorColumns"] = [];
    const fkRelationships: SourceTableAnalysis["fkRelationships"] = [];

    // Score field overlap
    for (const targetName of targetFieldNames) {
      let bestScore = 0;
      for (const sourceField of source.fields) {
        const score = scoreFieldMatch(targetName, sourceField.name);
        if (score > bestScore) bestScore = score;
      }
      if (bestScore > 30) {
        matchedFields++;
        totalScore += bestScore;
      }
    }

    // Detect discriminator columns
    for (const sourceField of source.fields) {
      if (isDiscriminatorColumn(sourceField.name)) {
        discriminatorColumns.push({
          column: sourceField.name,
          values: [], // Would need actual data to populate
          meaning: `Potential discriminator: ${sourceField.name}`,
        });
      }
    }

    // Detect FK relationships
    for (const sourceField of source.fields) {
      if (isFkColumn(sourceField.name)) {
        const ref = extractReferencedEntity(sourceField.name);
        if (ref) {
          fkRelationships.push({
            column: sourceField.name,
            referencesEntity: ref,
          });
        }
      }
    }

    // Normalize to 0-100 relevance score
    const maxPossible = targetFieldNames.length * 100;
    const relevanceScore = maxPossible > 0
      ? Math.round((totalScore / maxPossible) * 100)
      : 0;

    // Classify role
    let role: SourceTableAnalysis["role"];
    if (relevanceScore >= 30) role = "primary";
    else if (relevanceScore >= 15) role = "secondary";
    else if (relevanceScore >= 5) role = "lookup";
    else role = "irrelevant";

    results.push({
      name: source.name,
      relevanceScore,
      matchedFields,
      role,
      discriminatorColumns: discriminatorColumns.length > 0 ? discriminatorColumns : undefined,
      fkRelationships: fkRelationships.length > 0 ? fkRelationships : undefined,
    });
  }

  // Sort by relevance descending
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results;
}

/**
 * Detect discriminator columns in source entities that could indicate
 * assembly patterns (e.g., BorrowerIndicator for primary vs co-borrower).
 */
export function detectDiscriminatorColumns(
  sourceEntities: { name: string; fields: { name: string; dataType: string | null }[] }[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const source of sourceEntities) {
    const discriminators = source.fields
      .filter((f) => isDiscriminatorColumn(f.name))
      .map((f) => f.name);

    if (discriminators.length > 0) {
      result.set(source.name, discriminators);
    }
  }

  return result;
}

/**
 * Detect FK relationships between source entities and target entities.
 */
export function detectFkRelationships(
  sourceEntities: { name: string; fields: { name: string; dataType: string | null }[] }[],
  allTargetEntityNames: string[],
): Map<string, { column: string; referencesEntity: string }[]> {
  const targetNameSet = new Set(allTargetEntityNames.map((n) => n.toLowerCase()));
  const result = new Map<string, { column: string; referencesEntity: string }[]>();

  for (const source of sourceEntities) {
    const fks: { column: string; referencesEntity: string }[] = [];

    for (const f of source.fields) {
      if (isFkColumn(f.name)) {
        const ref = extractReferencedEntity(f.name);
        if (ref && targetNameSet.has(ref)) {
          fks.push({ column: f.name, referencesEntity: ref });
        }
      }
    }

    if (fks.length > 0) {
      result.set(source.name, fks);
    }
  }

  return result;
}

/**
 * Classify entity topology based on source table analysis.
 */
function classifyTopology(
  analyses: SourceTableAnalysis[],
): ScaffoldTopology {
  const primarySources = analyses.filter((a) => a.role === "primary");

  if (primarySources.length === 0) return "single_source";
  if (primarySources.length === 1) return "single_source";

  // Check for assembly indicators (discriminator columns in primary sources)
  const hasDiscriminators = primarySources.some(
    (s) => s.discriminatorColumns && s.discriminatorColumns.length > 0
  );

  if (hasDiscriminators) return "assembly";

  // Multiple primary sources — check if they're similar (same-type) or different
  // Use field count similarity as a proxy
  const fieldCounts = primarySources.map((s) => s.matchedFields);
  const avgCount = fieldCounts.reduce((a, b) => a + b, 0) / fieldCounts.length;
  const variance = fieldCounts.reduce((a, b) => a + Math.pow(b - avgCount, 2), 0) / fieldCounts.length;
  const cv = avgCount > 0 ? Math.sqrt(variance) / avgCount : 0;

  if (cv < 0.5) return "multi_source_same_type";
  return "multi_source_different_type";
}

/**
 * Build strategy notes summarizing the scaffold analysis.
 */
function buildStrategyNotes(
  entityName: string,
  topology: ScaffoldTopology,
  analyses: SourceTableAnalysis[],
): string {
  const primary = analyses.filter((a) => a.role === "primary").map((a) => a.name);
  const secondary = analyses.filter((a) => a.role === "secondary").map((a) => a.name);

  const parts: string[] = [];
  parts.push(`Entity "${entityName}" has ${topology.replace(/_/g, " ")} topology.`);

  if (primary.length > 0) {
    parts.push(`Primary sources: ${primary.join(", ")}.`);
  }
  if (secondary.length > 0) {
    parts.push(`Secondary sources (for joins/lookups): ${secondary.join(", ")}.`);
  }

  // Note discriminator columns
  const discriminators = analyses
    .filter((a) => a.discriminatorColumns?.length)
    .flatMap((a) => a.discriminatorColumns!.map((d) => `${a.name}.${d.column}`));

  if (discriminators.length > 0) {
    parts.push(`Discriminator columns detected: ${discriminators.join(", ")} — may indicate assembly pattern.`);
  }

  // Note FK relationships
  const fks = analyses
    .filter((a) => a.role === "primary" && a.fkRelationships?.length)
    .flatMap((a) => a.fkRelationships!.map((f) => `${a.name}.${f.column} → ${f.referencesEntity}`));

  if (fks.length > 0) {
    parts.push(`FK relationships: ${fks.join(", ")}.`);
  }

  return parts.join(" ");
}

// ── Main scaffold generation ─────────────────────────────────

/**
 * Generate a scaffold for a target entity. Uses heuristic analysis of
 * source-target field overlap, discriminator detection, and FK mapping.
 */
export function generateScaffold(
  workspaceId: string,
  entityId: string,
): EntityScaffoldData {
  // Load target entity
  const targetEntity = db
    .select()
    .from(entity)
    .where(and(eq(entity.id, entityId), eq(entity.workspaceId, workspaceId)))
    .get();

  if (!targetEntity) {
    throw new Error(`Entity ${entityId} not found`);
  }

  // Load target fields
  const targetFields = db
    .select()
    .from(field)
    .where(eq(field.entityId, entityId))
    .all();

  const targetFieldNames = targetFields.map((f) => f.name);

  // Load source entities and fields
  const sourceEntities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();

  const allFields = db
    .select()
    .from(field)
    .all();

  const sourceData = sourceEntities.map((se) => ({
    name: se.name,
    fields: allFields
      .filter((f) => f.entityId === se.id)
      .map((f) => ({ name: f.name, dataType: f.dataType })),
  }));

  // Load all target entity names for FK detection
  const allTargetEntities = db
    .select({ name: entity.name })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .all();

  const allTargetEntityNames = allTargetEntities.map((e) => e.name);

  // Run analyses
  const analyses = analyzeSourceOverlap(targetFieldNames, sourceData);
  const topology = classifyTopology(analyses);

  // Detect FK relationships for primary sources
  const fkMap = detectFkRelationships(sourceData, allTargetEntityNames);
  for (const analysis of analyses) {
    const fks = fkMap.get(analysis.name);
    if (fks && !analysis.fkRelationships) {
      analysis.fkRelationships = fks;
    }
  }

  const strategyNotes = buildStrategyNotes(
    targetEntity.name,
    topology,
    analyses,
  );

  return {
    entityName: targetEntity.name,
    topology,
    sourceTables: analyses,
    strategyNotes,
    primarySources: analyses.filter((a) => a.role === "primary").map((a) => a.name),
    secondarySources: analyses.filter((a) => a.role === "secondary").map((a) => a.name),
    excludedSources: analyses.filter((a) => a.role === "irrelevant").map((a) => a.name),
  };
}

// ── DB persistence ───────────────────────────────────────────

/**
 * Load cached scaffold from DB. Returns null if stale or missing.
 */
export function loadCachedScaffold(
  workspaceId: string,
  entityId: string,
): EntityScaffoldData | null {
  const row = db
    .select()
    .from(entityScaffold)
    .where(
      and(
        eq(entityScaffold.workspaceId, workspaceId),
        eq(entityScaffold.entityId, entityId),
        eq(entityScaffold.isStale, false),
      )
    )
    .get();

  if (!row) return null;

  return {
    entityName: row.strategyNotes?.split('"')[1] ?? "", // extract from notes
    topology: row.topology as ScaffoldTopology,
    sourceTables: (row.sourceTables ?? []) as SourceTableAnalysis[],
    assemblyComponents: row.assemblyComponents as Record<string, unknown>[] | undefined,
    strategyNotes: row.strategyNotes ?? "",
    primarySources: (row.primarySources ?? []) as string[],
    secondarySources: (row.secondarySources ?? []) as string[],
    excludedSources: (row.excludedSources ?? []) as string[],
  };
}

/**
 * Persist scaffold to DB for reuse across regenerations.
 */
export function persistScaffold(
  workspaceId: string,
  entityId: string,
  scaffold: EntityScaffoldData,
  opts?: { generationId?: string; batchRunId?: string },
): void {
  const now = new Date().toISOString();

  // Upsert: delete existing, insert new
  const existing = db
    .select({ id: entityScaffold.id })
    .from(entityScaffold)
    .where(
      and(
        eq(entityScaffold.workspaceId, workspaceId),
        eq(entityScaffold.entityId, entityId),
      )
    )
    .get();

  if (existing) {
    db.update(entityScaffold)
      .set({
        topology: scaffold.topology,
        sourceTables: scaffold.sourceTables as any,
        assemblyComponents: scaffold.assemblyComponents as any,
        strategyNotes: scaffold.strategyNotes,
        primarySources: scaffold.primarySources,
        secondarySources: scaffold.secondarySources,
        excludedSources: scaffold.excludedSources,
        isStale: false,
        generationId: opts?.generationId ?? null,
        batchRunId: opts?.batchRunId ?? null,
        updatedAt: now,
      })
      .where(eq(entityScaffold.id, existing.id))
      .run();
  } else {
    db.insert(entityScaffold)
      .values({
        workspaceId,
        entityId,
        topology: scaffold.topology,
        sourceTables: scaffold.sourceTables as any,
        assemblyComponents: scaffold.assemblyComponents as any,
        strategyNotes: scaffold.strategyNotes,
        primarySources: scaffold.primarySources,
        secondarySources: scaffold.secondarySources,
        excludedSources: scaffold.excludedSources,
        isStale: false,
        generationId: opts?.generationId ?? null,
        batchRunId: opts?.batchRunId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

/**
 * Mark scaffolds as stale for a workspace (e.g., when schemas change).
 */
export function markScaffoldsStale(workspaceId: string, entityIds?: string[]): void {
  const now = new Date().toISOString();

  if (entityIds?.length) {
    for (const eid of entityIds) {
      db.update(entityScaffold)
        .set({ isStale: true, updatedAt: now })
        .where(
          and(
            eq(entityScaffold.workspaceId, workspaceId),
            eq(entityScaffold.entityId, eid),
          )
        )
        .run();
    }
  } else {
    db.update(entityScaffold)
      .set({ isStale: true, updatedAt: now })
      .where(eq(entityScaffold.workspaceId, workspaceId))
      .run();
  }
}
