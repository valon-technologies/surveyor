/**
 * Deterministic YAML rebuilder — reconstructs the columns section from current
 * fieldMapping records while preserving entity-level structure (sources, joins, concat).
 * No LLM call needed. Fast and synchronous.
 */

import yaml from "js-yaml";
import { db } from "@/lib/db";
import { entityPipeline, fieldMapping, field, entity as entityTable } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { normalizeDtype } from "./dtype-normalizer";

interface RebuildResult {
  yamlSpec: string;
  columnsUpdated: number;
}

/**
 * Rebuild the YAML spec for an entity pipeline from current field mappings.
 * Updates the entityPipeline record and clears isStale.
 */
export function rebuildPipelineYaml(pipelineId: string): RebuildResult {
  const pipeline = db
    .select()
    .from(entityPipeline)
    .where(eq(entityPipeline.id, pipelineId))
    .get();

  if (!pipeline) {
    throw new Error(`Pipeline not found: ${pipelineId}`);
  }

  // Load current field mappings for this entity
  const fields = db
    .select()
    .from(field)
    .where(eq(field.entityId, pipeline.entityId))
    .orderBy(field.sortOrder)
    .all();

  const fieldIds = fields.map((f) => f.id);
  const latestMappings = db
    .select()
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, pipeline.workspaceId),
        eq(fieldMapping.isLatest, true)
      )
    )
    .all()
    .filter((m) => fieldIds.includes(m.targetFieldId));

  // Build mapping lookup by target field ID
  const mappingByFieldId = new Map(latestMappings.map((m) => [m.targetFieldId, m]));

  // Build alias lookup from pipeline sources
  const sources = pipeline.sources as { name: string; alias: string; table: string }[];
  const sourceEntityToAlias = new Map<string, string>();

  // Load source entities for the workspace to map aliases
  const sourceEntities = db
    .select()
    .from(entityTable)
    .where(and(eq(entityTable.workspaceId, pipeline.workspaceId), eq(entityTable.side, "source")))
    .all();

  for (const src of sources) {
    const matchedEntity = sourceEntities.find(
      (e) => e.name.toLowerCase() === src.table.toLowerCase() || e.name.toLowerCase() === src.name.toLowerCase()
    );
    if (matchedEntity) {
      sourceEntityToAlias.set(matchedEntity.id, src.alias);
    }
  }

  // Rebuild columns array
  const columns: Record<string, unknown>[] = [];
  for (const f of fields) {
    const mapping = mappingByFieldId.get(f.id);

    if (!mapping || mapping.status === "unmapped") {
      columns.push({
        target_column: f.name,
        source: [],
        transform: "null",
        dtype: normalizeDtype(f.dataType),
      });
      continue;
    }

    // Determine source reference
    let source: unknown = [];
    if (mapping.sourceFieldId) {
      const sourceField = db.select().from(field).where(eq(field.id, mapping.sourceFieldId)).get();
      if (sourceField) {
        const alias = sourceEntityToAlias.get(sourceField.entityId);
        source = alias ? `${alias}.${sourceField.name}` : sourceField.name;
      }
    }

    // Determine transform type
    let transform = mapping.sourceFieldId ? "identity" : "null";
    if (mapping.mappingType === "hash_id") {
      transform = "hash_id";
    } else if (mapping.transform) {
      transform = "expression";
    } else if (mapping.defaultValue && !mapping.sourceFieldId) {
      transform = "literal";
      source = { literal: mapping.defaultValue };
    } else if (mapping.mappingType === "enum") {
      transform = "expression";
    }

    const col: Record<string, unknown> = {
      target_column: f.name,
      source,
      transform,
      dtype: normalizeDtype(f.dataType),
    };

    if (mapping.mappingType === "hash_id") {
      try {
        col.hash_columns = JSON.parse(mapping.transform ?? "[]");
      } catch {
        col.hash_columns = [];
      }
    } else if (mapping.transform) {
      col.expression = mapping.transform;
    }

    columns.push(col);
  }

  // Rebuild the full YAML structure
  const yamlObj: Record<string, unknown> = {
    table: pipeline.tableName,
    version: pipeline.version,
  };

  if (pipeline.primaryKey) {
    yamlObj.primary_key = pipeline.primaryKey;
  }

  // Parse original yamlSpec to recover per-source type (pipe_file vs staging)
  const originalSourceTypes = new Map<string, string>();
  if (pipeline.yamlSpec) {
    try {
      const parsed = yaml.load(pipeline.yamlSpec) as Record<string, unknown>;
      const origSources = parsed.sources as Record<string, unknown>[] | undefined;
      if (Array.isArray(origSources)) {
        for (const os of origSources) {
          const alias = os.alias as string;
          if (os.pipe_file) originalSourceTypes.set(alias, "pipe_file");
          else if (os.staging) originalSourceTypes.set(alias, "staging");
        }
      }
    } catch {
      // Fall through to default
    }
  }

  yamlObj.sources = sources.map((s) => {
    const src: Record<string, unknown> = {
      name: s.name,
      alias: s.alias,
    };
    const sourceType = originalSourceTypes.get(s.alias) ?? "pipe_file";
    src[sourceType] = { table: s.table };
    return src;
  });

  if (pipeline.joins) {
    yamlObj.joins = pipeline.joins;
  }

  if (pipeline.concat) {
    yamlObj.concat = pipeline.concat;
  }

  yamlObj.columns = columns;

  const yamlSpec = yaml.dump(yamlObj, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });

  // Update the pipeline record
  db.update(entityPipeline)
    .set({
      yamlSpec,
      isStale: false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(entityPipeline.id, pipelineId))
    .run();

  return { yamlSpec, columnsUpdated: columns.length };
}
