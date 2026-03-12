import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { entity, field, fieldMapping } from "@/lib/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

// GET — List all excluded entities and fields
export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  // Excluded entities: transferExcluded=true in metadata
  const allEntities = await db
    .select({
      id: entity.id,
      name: entity.name,
      displayName: entity.displayName,
      metadata: entity.metadata,
    })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")));

  const excludedEntities: Array<{
    id: string;
    name: string;
    displayName: string | null;
    fieldCount: number;
  }> = [];

  for (const e of allEntities) {
    const meta = e.metadata as Record<string, unknown> | null;
    if (meta?.transferExcluded !== true) continue;

    const fields = await db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, e.id));

    excludedEntities.push({
      id: e.id,
      name: e.name,
      displayName: e.displayName,
      fieldCount: fields.length,
    });
  }

  // Excluded fields: status="excluded" with isLatest=true (SDT only)
  const excludedFields = await db
    .select({
      mappingId: fieldMapping.id,
      targetFieldId: fieldMapping.targetFieldId,
      fieldName: field.name,
      entityName: entity.name,
      entityId: entity.id,
      sourceEntityId: fieldMapping.sourceEntityId,
      sourceFieldId: fieldMapping.sourceFieldId,
      transform: fieldMapping.transform,
      confidence: fieldMapping.confidence,
      excludeReason: fieldMapping.excludeReason,
    })
    .from(fieldMapping)
    .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true),
        eq(fieldMapping.status, "excluded"),
        isNull(fieldMapping.transferId),
      )
    )
    .orderBy(entity.name, field.name);

  // Resolve source names
  const sourceEntityIds = new Set(
    excludedFields.map((f) => f.sourceEntityId).filter(Boolean) as string[]
  );
  const sourceFieldIds = new Set(
    excludedFields.map((f) => f.sourceFieldId).filter(Boolean) as string[]
  );

  const entityNameMap = new Map<string, string>();
  const fieldNameMap = new Map<string, string>();

  if (sourceEntityIds.size > 0) {
    const entities = await db.select({ id: entity.id, name: entity.name }).from(entity);
    for (const e of entities) entityNameMap.set(e.id, e.name);
  }
  if (sourceFieldIds.size > 0) {
    const fields = await db.select({ id: field.id, name: field.name }).from(field);
    for (const f of fields) fieldNameMap.set(f.id, f.name);
  }

  const excludedFieldsList = excludedFields.map((f) => {
    const sourceName = f.sourceEntityId ? entityNameMap.get(f.sourceEntityId) : null;
    const sourceField = f.sourceFieldId ? fieldNameMap.get(f.sourceFieldId) : null;
    return {
      mappingId: f.mappingId,
      entityName: f.entityName,
      entityId: f.entityId,
      fieldName: f.fieldName,
      source: sourceName && sourceField ? `${sourceName}.${sourceField}` : null,
      transform: f.transform,
      confidence: f.confidence,
      excludeReason: f.excludeReason,
    };
  });

  return NextResponse.json({
    excludedEntities,
    excludedFields: excludedFieldsList,
    stats: {
      entityCount: excludedEntities.length,
      entityFieldCount: excludedEntities.reduce((sum, e) => sum + e.fieldCount, 0),
      fieldCount: excludedFieldsList.length,
    },
  });
});

// POST — Restore excluded entities or fields
export const POST = withAuth(async (req, ctx, { workspaceId }) => {
  const body = await req.json();
  const { action, entityId, mappingIds } = body as {
    action: "restore-entity" | "restore-fields";
    entityId?: string;
    mappingIds?: string[];
  };

  const now = new Date().toISOString();

  if (action === "restore-entity" && entityId) {
    // Clear transferExcluded metadata
    const [existing] = await db
      .select({ metadata: entity.metadata })
      .from(entity)
      .where(eq(entity.id, entityId));

    if (existing) {
      const meta = { ...(existing.metadata as Record<string, unknown> || {}) };
      delete meta.transferExcluded;
      delete meta.transferExcludeReason;

      await db
        .update(entity)
        .set({ metadata: meta, updatedAt: now })
        .where(eq(entity.id, entityId));
    }

    // Also restore all excluded field mappings for this entity
    const entityFields = await db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, entityId));
    const fieldIds = entityFields.map((f) => f.id);

    let fieldsRestored = 0;
    if (fieldIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      const result = await db
        .update(fieldMapping)
        .set({ status: "unreviewed", excludeReason: null, updatedAt: now })
        .where(
          and(
            eq(fieldMapping.workspaceId, workspaceId),
            eq(fieldMapping.isLatest, true),
            eq(fieldMapping.status, "excluded"),
            isNull(fieldMapping.transferId),
            inArray(fieldMapping.targetFieldId, fieldIds),
          )
        );
      fieldsRestored = result.length;
    }

    return NextResponse.json({
      message: `Entity restored. ${fieldsRestored} field exclusions reverted.`,
      fieldsRestored,
    });
  }

  if (action === "restore-fields" && mappingIds?.length) {
    const { inArray } = await import("drizzle-orm");
    const result = await db
      .update(fieldMapping)
      .set({ status: "unreviewed", excludeReason: null, updatedAt: now })
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true),
          eq(fieldMapping.status, "excluded"),
          inArray(fieldMapping.id, mappingIds),
        )
      );

    return NextResponse.json({
      message: `${result.length} field exclusions reverted.`,
      fieldsRestored: result.length,
    });
  }

  return NextResponse.json({ error: "Invalid action or missing parameters" }, { status: 400 });
}, { requiredRole: "editor" });
