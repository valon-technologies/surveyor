/**
 * Synthesizes an entityPipeline record from existing fieldMapping records.
 * Used when chat-mode batch runs complete (which create per-field mappings
 * but no entity-level pipeline), and as a fallback in the pipeline API route.
 */

import yaml from "js-yaml";
import { db } from "@/lib/db";
import {
  entity,
  field,
  fieldMapping,
  entityPipeline,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { normalizeDtype } from "./dtype-normalizer";

export async function synthesizePipelineFromMappings(opts: {
  workspaceId: string;
  entityId: string;
  entityName: string;
  batchRunId?: string;
}): Promise<void> {
  const { workspaceId, entityId, entityName, batchRunId } = opts;
  const timestamp = new Date().toISOString();

  // Load target entity info
  const targetEntity = (await db
    .select()
    .from(entity)
    .where(eq(entity.id, entityId))
    )[0];
  const tableName = targetEntity?.name || entityName;

  // Load all fields for this entity (ordered)
  const fields = await db
    .select()
    .from(field)
    .where(eq(field.entityId, entityId))
    .orderBy(field.sortOrder)
    ;

  // Load latest field mappings
  const fieldIds = fields.map((f) => f.id);
  const mappings = (await db
    .select()
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true)
      )
    )
)
    .filter((m) => fieldIds.includes(m.targetFieldId));

  const mappingByFieldId = new Map(mappings.map((m) => [m.targetFieldId, m]));

  // Collect distinct source entities referenced by mappings
  const sourceEntityIds = new Set<string>();
  for (const m of mappings) {
    if (m.sourceEntityId) sourceEntityIds.add(m.sourceEntityId);
  }

  // Load source entity details
  const sourceEntities =
    sourceEntityIds.size > 0
      ? (await db
          .select()
          .from(entity)
          .where(eq(entity.workspaceId, workspaceId))
          )
          .filter((e: { id: string }) => sourceEntityIds.has(e.id))
      : [];

  // Build sources array with short aliases
  const aliasCount = new Map<string, number>();
  const sources: { name: string; alias: string; table: string }[] = [];
  const entityIdToAlias = new Map<string, string>();

  for (const src of sourceEntities) {
    const parts = src.name.split(/[_.\s]+/).filter(Boolean);
    let alias =
      parts.length > 1
        ? parts.map((p) => p[0]?.toLowerCase()).join("")
        : src.name.substring(0, 3).toLowerCase();

    const count = aliasCount.get(alias) || 0;
    aliasCount.set(alias, count + 1);
    if (count > 0) alias = `${alias}${count + 1}`;

    sources.push({ name: src.name, alias, table: src.name });
    entityIdToAlias.set(src.id, alias);
  }

  // Detect key fields for primary_key
  const keyFields = fields.filter((f) => f.isKey).map((f) => f.name);

  // Build columns array
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

    let source: unknown = [];
    if (mapping.sourceFieldId) {
      const sourceField = (await db
        .select()
        .from(field)
        .where(eq(field.id, mapping.sourceFieldId))
        )[0];
      if (sourceField) {
        const alias = entityIdToAlias.get(sourceField.entityId);
        source = alias ? `${alias}.${sourceField.name}` : sourceField.name;
      }
    }

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

  // Build YAML object
  const yamlObj: Record<string, unknown> = {
    table: tableName,
    version: 1,
  };

  if (keyFields.length > 0) {
    yamlObj.primary_key = keyFields;
  }

  yamlObj.sources = sources.map((s) => ({
    name: s.name,
    alias: s.alias,
    pipe_file: { table: s.table },
  }));

  yamlObj.columns = columns;

  const yamlSpec = yaml.dump(yamlObj, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });

  // Check for existing pipeline and version appropriately
  const existing = (await db
    .select()
    .from(entityPipeline)
    .where(
      and(
        eq(entityPipeline.entityId, entityId),
        eq(entityPipeline.isLatest, true)
      )
    )
    )[0];

  if (existing) {
    await db.update(entityPipeline)
      .set({ isLatest: false, updatedAt: timestamp })
      .where(eq(entityPipeline.id, existing.id))
      ;
  }

  await db.insert(entityPipeline)
    .values({
      workspaceId,
      entityId,
      version: existing ? existing.version + 1 : 1,
      parentId: existing?.id ?? null,
      isLatest: true,
      yamlSpec,
      tableName,
      primaryKey: keyFields.length > 0 ? keyFields : null,
      sources,
      joins: null,
      concat: null,
      structureType: "flat",
      isStale: false,
      batchRunId: batchRunId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    ;

  console.log(
    `[pipeline-synthesizer] Created pipeline for "${entityName}": ${sources.length} sources, ${columns.length} columns`
  );
}
