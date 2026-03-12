/**
 * Evaluation orchestrator — compares Surveyor's generated field mappings
 * against SOT (Source of Truth) ground truth from mapping-engine eval JSONs.
 */

import { db } from "@/lib/db";
import { entity, field, fieldMapping } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { loadSotForEntity } from "./sot-loader";
import { matchSources, isScorable, capTransformMatch, type FieldSourceMatch, type SourceMatchType } from "./source-matcher";
import { evaluateTransforms, loadSotYamlChain, type GenMappingInput, type TransformFieldResult } from "./transform-evaluator";
import type { LLMProvider } from "@/lib/llm/provider";

export interface MappingEvaluation {
  entityId: string;
  entityName: string;
  generationId: string | null;
  totalFields: number;
  scoredFields: number;         // excludes NO_SOT
  sourceExactCount: number;     // EXACT + BOTH_NULL
  sourceLenientCount: number;   // EXACT + BOTH_NULL + SUBSET + SUPERSET + OVERLAP
  sourceExactPct: number;
  sourceLenientPct: number;
  // Transform eval (populated when includeTransform is true)
  transformExactCount?: number;
  transformLenientCount?: number;
  transformExactPct?: number;
  transformLenientPct?: number;
  fieldResults: FieldSourceMatch[];
}

/**
 * Evaluate all latest field mappings for an entity against SOT.
 * Returns null if no SOT data exists for the entity.
 *
 * For assembly entities (those with component children in the DB),
 * aggregates genSources from all component mappings before scoring.
 */
export async function evaluateEntityMappings(
  workspaceId: string,
  entityId: string,
  options?: { includeTransform?: boolean; provider?: LLMProvider },
): Promise<MappingEvaluation | null> {
  // 1. Load the target entity
  const targetEntity = (await db
    .select()
    .from(entity)
    .where(and(eq(entity.id, entityId), eq(entity.workspaceId, workspaceId)))
)[0];

  if (!targetEntity) {
    throw new Error(`Entity ${entityId} not found`);
  }

  // 2. Load SOT data (now includes merged staging component sources for assembly parents)
  const sotData = loadSotForEntity(targetEntity.name);
  if (!sotData) {
    return null; // no SOT available
  }

  // 3. Load all target fields for this entity
  const targetFields = await db
    .select()
    .from(field)
    .where(eq(field.entityId, entityId))
    ;

  // 4. Check if this is an assembly entity with component children
  const componentEntities = await db
    .select()
    .from(entity)
    .where(and(eq(entity.parentEntityId, entityId), eq(entity.workspaceId, workspaceId)))
    ;

  if (componentEntities.length > 0) {
    return await evaluateAssemblyEntity(
      workspaceId, entityId, targetEntity, sotData, targetFields, componentEntities,
    );
  }

  // 5. Load latest SDT field mappings (transferId IS NULL) with source entity/field names resolved
  const latestMappings = (await db
    .select({
      targetFieldId: fieldMapping.targetFieldId,
      sourceEntityId: fieldMapping.sourceEntityId,
      sourceFieldId: fieldMapping.sourceFieldId,
      transform: fieldMapping.transform,
      generationId: fieldMapping.generationId,
      status: fieldMapping.status,
    })
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true),
        isNull(fieldMapping.transferId),
      )
    )
    )
    // Only mappings for this entity's target fields
    .filter((m) => targetFields.some((tf) => tf.id === m.targetFieldId));

  // Build lookup: targetFieldId → mapping
  const mappingByTargetFieldId = new Map(
    latestMappings.map((m) => [m.targetFieldId, m])
  );

  // Resolve source entity/field names in batch
  const sourceEntityIds = new Set(
    latestMappings.map((m) => m.sourceEntityId).filter(Boolean) as string[]
  );
  const sourceFieldIds = new Set(
    latestMappings.map((m) => m.sourceFieldId).filter(Boolean) as string[]
  );

  const entityNameById = new Map<string, string>();
  if (sourceEntityIds.size > 0) {
    const entities = await db.select().from(entity)
      ;
    for (const e of entities) {
      entityNameById.set(e.id, e.name);
    }
  }

  const fieldNameById = new Map<string, string>();
  if (sourceFieldIds.size > 0) {
    const fields = await db.select().from(field)
      ;
    for (const f of fields) {
      fieldNameById.set(f.id, f.name);
    }
  }

  // 5. Match each target field against SOT
  const fieldResults: FieldSourceMatch[] = [];
  let generationId: string | null = null;

  for (const tf of targetFields) {
    const sotField = sotData.fields[tf.name];
    const mapping = mappingByTargetFieldId.get(tf.id);

    // Build gen sources from the mapping
    const genSources: string[] = [];
    if (mapping?.sourceEntityId && mapping?.sourceFieldId) {
      const seName = entityNameById.get(mapping.sourceEntityId);
      const sfName = fieldNameById.get(mapping.sourceFieldId);
      if (seName && sfName) {
        genSources.push(`${seName}.${sfName}`);
      }
    }

    // Also extract additional source references from transform expression
    if (mapping?.transform) {
      const additionalRefs = extractTransformSources(mapping.transform, entityNameById);
      for (const ref of additionalRefs) {
        if (!genSources.includes(ref)) {
          genSources.push(ref);
        }
      }
    }

    // Track the generation that produced these mappings
    if (mapping?.generationId && !generationId) {
      generationId = mapping.generationId;
    }

    const sotSources = sotField?.sotSources || [];
    const fieldInSot = !!sotField;

    const { matchType, score } = matchSources(genSources, sotSources, fieldInSot);

    fieldResults.push({
      field: tf.name,
      matchType,
      score,
      genSources,
      sotSources,
    });
  }

  // 6. Compute aggregate source scores
  const scorableResults = fieldResults.filter((r) => isScorable(r.matchType));
  const scoredFields = scorableResults.length;
  const sourceExactCount = scorableResults.filter(
    (r) => r.matchType === "EXACT" || r.matchType === "BOTH_NULL"
  ).length;
  const sourceLenientCount = scorableResults.filter(
    (r) =>
      r.matchType === "EXACT" ||
      r.matchType === "BOTH_NULL" ||
      r.matchType === "SUBSET" ||
      r.matchType === "SUPERSET" ||
      r.matchType === "OVERLAP"
  ).length;

  const sourceExactPct = scoredFields > 0
    ? Math.round((sourceExactCount / scoredFields) * 1000) / 10
    : 0;
  const sourceLenientPct = scoredFields > 0
    ? Math.round((sourceLenientCount / scoredFields) * 1000) / 10
    : 0;

  const result: MappingEvaluation = {
    entityId,
    entityName: targetEntity.name,
    generationId,
    totalFields: targetFields.length,
    scoredFields,
    sourceExactCount,
    sourceLenientCount,
    sourceExactPct,
    sourceLenientPct,
    fieldResults,
  };

  // 7. Optional transform evaluation via Opus
  if (options?.includeTransform && options.provider) {
    await runTransformEval(result, targetEntity.name, mappingByTargetFieldId, targetFields, entityNameById, fieldNameById, options.provider);
  }

  return result;
}

/**
 * Evaluate an assembly entity by aggregating genSources from all component
 * entity mappings, then comparing against the merged SOT (which includes
 * ACDC sources from all staging components).
 */
async function evaluateAssemblyEntity(
  workspaceId: string,
  entityId: string,
  targetEntity: { id: string; name: string },
  sotData: import("./sot-loader").SotEntityData,
  targetFields: { id: string; name: string }[],
  componentEntities: { id: string; name: string }[],
): Promise<MappingEvaluation> {
  // Load all entities and fields for name resolution (batch)
  const allEntities = await db.select().from(entity)
    ;
  const entityNameById = new Map(allEntities.map((e) => [e.id, e.name]));
  const allFields = await db.select().from(field)
    ;
  const fieldNameById = new Map(allFields.map((f) => [f.id, f.name]));

  // For each parent field, aggregate genSources from all component mappings
  const aggregatedGenSources = new Map<string, string[]>();
  let generationId: string | null = null;

  for (const compEntity of componentEntities) {
    const compFields = await db
      .select()
      .from(field)
      .where(eq(field.entityId, compEntity.id))
      ;

    const compMappings = (await db
      .select({
        targetFieldId: fieldMapping.targetFieldId,
        sourceEntityId: fieldMapping.sourceEntityId,
        sourceFieldId: fieldMapping.sourceFieldId,
        transform: fieldMapping.transform,
        generationId: fieldMapping.generationId,
      })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true),
          isNull(fieldMapping.transferId),
        )
      )
      )
      .filter((m) => compFields.some((cf) => cf.id === m.targetFieldId));

    const compMappingByFieldId = new Map(
      compMappings.map((m) => [m.targetFieldId, m])
    );

    for (const cf of compFields) {
      const mapping = compMappingByFieldId.get(cf.id);
      if (!mapping) continue;

      if (mapping.generationId && !generationId) {
        generationId = mapping.generationId;
      }

      // Build genSources for this component's mapping
      const genSources: string[] = [];
      if (mapping.sourceEntityId && mapping.sourceFieldId) {
        const seName = entityNameById.get(mapping.sourceEntityId);
        const sfName = fieldNameById.get(mapping.sourceFieldId);
        if (seName && sfName) genSources.push(`${seName}.${sfName}`);
      }
      if (mapping.transform) {
        const additionalRefs = extractTransformSources(mapping.transform, entityNameById);
        for (const ref of additionalRefs) {
          if (!genSources.includes(ref)) genSources.push(ref);
        }
      }

      // Merge into aggregated (deduplicated)
      const existing = aggregatedGenSources.get(cf.name) || [];
      for (const src of genSources) {
        if (!existing.includes(src)) existing.push(src);
      }
      aggregatedGenSources.set(cf.name, existing);
    }
  }

  // Match each parent field against SOT using aggregated genSources
  const fieldResults: FieldSourceMatch[] = [];

  for (const tf of targetFields) {
    const sotField = sotData.fields[tf.name];
    const genSources = aggregatedGenSources.get(tf.name) || [];
    const sotSources = sotField?.sotSources || [];
    const fieldInSot = !!sotField;

    const { matchType, score } = matchSources(genSources, sotSources, fieldInSot);
    fieldResults.push({ field: tf.name, matchType, score, genSources, sotSources });
  }

  // Compute aggregate scores
  const scorableResults = fieldResults.filter((r) => isScorable(r.matchType));
  const scoredFields = scorableResults.length;
  const sourceExactCount = scorableResults.filter(
    (r) => r.matchType === "EXACT" || r.matchType === "BOTH_NULL"
  ).length;
  const sourceLenientCount = scorableResults.filter(
    (r) =>
      r.matchType === "EXACT" ||
      r.matchType === "BOTH_NULL" ||
      r.matchType === "SUBSET" ||
      r.matchType === "SUPERSET" ||
      r.matchType === "OVERLAP"
  ).length;

  const sourceExactPct = scoredFields > 0
    ? Math.round((sourceExactCount / scoredFields) * 1000) / 10
    : 0;
  const sourceLenientPct = scoredFields > 0
    ? Math.round((sourceLenientCount / scoredFields) * 1000) / 10
    : 0;

  return {
    entityId,
    entityName: targetEntity.name,
    generationId,
    totalFields: targetFields.length,
    scoredFields,
    sourceExactCount,
    sourceLenientCount,
    sourceExactPct,
    sourceLenientPct,
    fieldResults,
  };
}

/**
 * Run Opus-based transform evaluation and merge results into the MappingEvaluation.
 * Mutates `result.fieldResults` in place to add transform data, and sets transform metrics.
 */
async function runTransformEval(
  result: MappingEvaluation,
  entityName: string,
  mappingByTargetFieldId: Map<string, { sourceEntityId: string | null; sourceFieldId: string | null; transform: string | null }>,
  targetFields: { id: string; name: string }[],
  entityNameById: Map<string, string>,
  fieldNameById: Map<string, string>,
  provider: LLMProvider,
) {
  const sotYaml = loadSotYamlChain(entityName);
  if (!sotYaml) return;

  // Build GenMappingInput array
  const genMappings: GenMappingInput[] = [];
  for (const tf of targetFields) {
    const mapping = mappingByTargetFieldId.get(tf.id);
    const sourceEntity = mapping?.sourceEntityId ? entityNameById.get(mapping.sourceEntityId) ?? "" : "";
    const sourceField = mapping?.sourceFieldId ? fieldNameById.get(mapping.sourceFieldId) ?? "" : "";
    genMappings.push({
      targetField: tf.name,
      sourceEntity,
      sourceField,
      transform: mapping?.transform ?? null,
      mappingType: sourceEntity ? "mapped" : "unmapped",
    });
  }

  const transformResults = await evaluateTransforms(entityName, genMappings, sotYaml, provider);

  // Build lookup by field name
  const transformByField = new Map(transformResults.map((r) => [r.field, r]));

  // Merge into fieldResults with source-based capping
  let transformExactCount = 0;
  let transformLenientCount = 0;
  let transformScoredFields = 0;

  for (const fr of result.fieldResults) {
    const tr = transformByField.get(fr.field);
    if (!tr) continue;

    // Apply source-based capping
    const capped = capTransformMatch(fr.matchType, tr.transformMatch, tr.transformSimilarity);

    fr.transformMatch = capped.transformMatch;
    fr.transformSimilarity = capped.similarity;
    fr.transformExplanation = tr.explanation;
    fr.sotTransformSummary = tr.sotSummary;
    fr.genTransformSummary = tr.candidateSummary;

    // Score (exclude N/A from counts)
    if (capped.transformMatch !== "N/A" && isScorable(fr.matchType)) {
      transformScoredFields++;
      if (capped.transformMatch === "MATCH") transformExactCount++;
      if (capped.transformMatch === "MATCH" || capped.transformMatch === "PARTIAL") transformLenientCount++;
    }
  }

  if (transformScoredFields > 0) {
    result.transformExactCount = transformExactCount;
    result.transformLenientCount = transformLenientCount;
    result.transformExactPct = Math.round((transformExactCount / transformScoredFields) * 1000) / 10;
    result.transformLenientPct = Math.round((transformLenientCount / transformScoredFields) * 1000) / 10;
  }
}

/**
 * Extract additional Table.Field references from a transform expression.
 * Matches patterns like `alias.FieldName` where alias maps to a known entity.
 */
function extractTransformSources(
  transform: string,
  entityNameById: Map<string, string>,
): string[] {
  const refs: string[] = [];
  // Build reverse map: lowercased entity name → canonical name
  const entityByLower = new Map<string, string>();
  for (const name of entityNameById.values()) {
    entityByLower.set(name.toLowerCase(), name);
  }

  // Match alias.field patterns in SQL expressions
  const pattern = /\b([A-Za-z][A-Za-z0-9_]*?)\.([A-Za-z_]\w*)/g;
  let match;
  while ((match = pattern.exec(transform)) !== null) {
    const [, alias, fieldName] = match;
    // Check if alias matches a known entity name
    const canonical = entityByLower.get(alias.toLowerCase());
    if (canonical) {
      refs.push(`${canonical}.${fieldName}`);
    }
  }
  return refs;
}
