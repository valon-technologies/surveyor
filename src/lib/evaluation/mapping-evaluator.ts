/**
 * Evaluation orchestrator — compares Surveyor's generated field mappings
 * against SOT (Source of Truth) ground truth from mapping-engine eval JSONs.
 */

import { db } from "@/lib/db";
import { entity, field, fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { loadSotForEntity } from "./sot-loader";
import { matchSources, isScorable, type FieldSourceMatch, type SourceMatchType } from "./source-matcher";

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
  fieldResults: FieldSourceMatch[];
}

/**
 * Evaluate all latest field mappings for an entity against SOT.
 * Returns null if no SOT data exists for the entity.
 */
export function evaluateEntityMappings(
  workspaceId: string,
  entityId: string,
): MappingEvaluation | null {
  // 1. Load the target entity
  const targetEntity = db
    .select()
    .from(entity)
    .where(and(eq(entity.id, entityId), eq(entity.workspaceId, workspaceId)))
    .get();

  if (!targetEntity) {
    throw new Error(`Entity ${entityId} not found`);
  }

  // 2. Load SOT data
  const sotData = loadSotForEntity(targetEntity.name);
  if (!sotData) {
    return null; // no SOT available
  }

  // 3. Load all target fields for this entity
  const targetFields = db
    .select()
    .from(field)
    .where(eq(field.entityId, entityId))
    .all();

  // 4. Load latest field mappings with source entity/field names resolved
  const latestMappings = db
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
      )
    )
    .all()
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
    const entities = db.select().from(entity).all();
    for (const e of entities) {
      entityNameById.set(e.id, e.name);
    }
  }

  const fieldNameById = new Map<string, string>();
  if (sourceFieldIds.size > 0) {
    const fields = db.select().from(field).all();
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

  // 6. Compute aggregate scores
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
