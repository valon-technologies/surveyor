/**
 * Pattern transfer for assembly entities — extracts mapping patterns from
 * a completed primary component and builds delta prompts for similar
 * secondary components.
 *
 * This reduces LLM work: instead of mapping N similar components independently,
 * map the primary fully, then for each secondary component say
 * "follow the same pattern, use these columns instead".
 */

import { db } from "@/lib/db";
import { entity, field, fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface ComponentPattern {
  componentName: string;
  /** Summary of the mapping approach (sources, key transforms, patterns) */
  patternSummary: string;
  /** Per-field mapping summaries for pattern reference */
  fieldPatterns: {
    targetField: string;
    sourceEntity: string | null;
    sourceField: string | null;
    mappingType: string | null;
    transform: string | null;
    confidence: string | null;
  }[];
}

/**
 * Extract the mapping pattern from a completed component entity.
 * Used as reference when mapping similar components.
 */
export function extractComponentPattern(
  workspaceId: string,
  componentEntityId: string,
): ComponentPattern | null {
  // Load the component entity
  const comp = db
    .select()
    .from(entity)
    .where(eq(entity.id, componentEntityId))
    .get();

  if (!comp) return null;

  // Load latest mappings for this component
  const fields = db
    .select()
    .from(field)
    .where(eq(field.entityId, componentEntityId))
    .all();

  const fieldPatterns: ComponentPattern["fieldPatterns"] = [];

  for (const f of fields) {
    const mapping = db
      .select()
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.targetFieldId, f.id),
          eq(fieldMapping.isLatest, true),
        )
      )
      .get();

    if (!mapping) continue;

    // Resolve source entity name
    let sourceEntityName: string | null = null;
    if (mapping.sourceEntityId) {
      const se = db
        .select({ name: entity.name })
        .from(entity)
        .where(eq(entity.id, mapping.sourceEntityId))
        .get();
      sourceEntityName = se?.name ?? null;
    }

    // Resolve source field name
    let sourceFieldName: string | null = null;
    if (mapping.sourceFieldId) {
      const sf = db
        .select({ name: field.name })
        .from(field)
        .where(eq(field.id, mapping.sourceFieldId))
        .get();
      sourceFieldName = sf?.name ?? null;
    }

    fieldPatterns.push({
      targetField: f.name,
      sourceEntity: sourceEntityName,
      sourceField: sourceFieldName,
      mappingType: mapping.mappingType,
      transform: mapping.transform,
      confidence: mapping.confidence,
    });
  }

  if (fieldPatterns.length === 0) return null;

  // Build pattern summary
  const sourceEntities = [...new Set(fieldPatterns
    .filter((p) => p.sourceEntity)
    .map((p) => p.sourceEntity!)
  )];

  const mappingTypes = [...new Set(fieldPatterns
    .filter((p) => p.mappingType)
    .map((p) => p.mappingType!)
  )];

  const patternSummary = [
    `Component "${comp.name}" maps from: ${sourceEntities.join(", ") || "no sources"}.`,
    `Mapping types used: ${mappingTypes.join(", ")}.`,
    `${fieldPatterns.length} fields mapped, ${fieldPatterns.filter((p) => p.confidence === "high").length} high confidence.`,
  ].join(" ");

  return {
    componentName: comp.name,
    patternSummary,
    fieldPatterns,
  };
}

/**
 * Build a delta prompt section for a secondary component based on the
 * primary component's pattern. Tells the LLM to follow the same approach
 * but use different source columns.
 */
export function buildDeltaPromptSection(
  primaryPattern: ComponentPattern,
  deltaComponentName: string,
): string {
  const parts: string[] = [];

  parts.push(`## Component Pattern Transfer`);
  parts.push(
    `This component ("${deltaComponentName}") is structurally similar to the ` +
    `primary component ("${primaryPattern.componentName}"). Follow the same ` +
    `mapping approach but adapt source columns as needed.\n`
  );

  parts.push(`### Primary Component Pattern`);
  parts.push(primaryPattern.patternSummary);
  parts.push("");

  // Show key field patterns for reference
  const keyPatterns = primaryPattern.fieldPatterns
    .filter((p) => p.sourceField && p.confidence === "high")
    .slice(0, 15); // Limit to keep prompt manageable

  if (keyPatterns.length > 0) {
    parts.push(`### Reference Mappings (from primary component)\n`);
    for (const p of keyPatterns) {
      const transform = p.transform ? ` [transform: ${p.transform}]` : "";
      parts.push(`- ${p.targetField} ← ${p.sourceEntity}.${p.sourceField} (${p.mappingType})${transform}`);
    }
    parts.push("");
  }

  parts.push(
    `**Instructions:** Follow the same mapping patterns above. For each field, ` +
    `use the equivalent source column from this component's source tables. ` +
    `If a field maps differently in this component, explain why.`
  );

  return parts.join("\n");
}

/**
 * Extract FK constraint patterns from completed entity mappings.
 * Used to inject into downstream entity prompts for consistency.
 */
export function extractFKConstraints(
  workspaceId: string,
  entityId: string,
): { entityName: string; idField: string; hashColumns: string[] | null; transform: string | null }[] {
  const targetEntity = db
    .select()
    .from(entity)
    .where(eq(entity.id, entityId))
    .get();

  if (!targetEntity) return [];

  // Find key fields (likely PKs)
  const keyFields = db
    .select()
    .from(field)
    .where(and(eq(field.entityId, entityId), eq(field.isKey, true)))
    .all();

  const constraints: { entityName: string; idField: string; hashColumns: string[] | null; transform: string | null }[] = [];

  for (const kf of keyFields) {
    const mapping = db
      .select()
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.targetFieldId, kf.id),
          eq(fieldMapping.isLatest, true),
        )
      )
      .get();

    if (!mapping) continue;

    // Extract hash_columns from transform if it's a hash_id mapping
    let hashColumns: string[] | null = null;
    if (mapping.mappingType === "hash_id" && mapping.transform) {
      try {
        // Parse hash_columns from various formats
        const match = mapping.transform.match(/hash_columns:\s*\[(.*?)\]/);
        if (match) {
          hashColumns = match[1].split(",").map((s) => s.trim().replace(/['"]/g, ""));
        }
      } catch {
        // Non-critical
      }
    }

    constraints.push({
      entityName: targetEntity.name,
      idField: kf.name,
      hashColumns,
      transform: mapping.transform,
    });
  }

  return constraints;
}
