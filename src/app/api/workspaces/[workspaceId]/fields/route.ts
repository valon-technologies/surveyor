import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { entity, field, fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface FieldRow {
  fieldId: string;
  fieldName: string;
  entityId: string;
  entityName: string;
  dataType: string | null;
  description: string | null;
  milestone: string | null;
  enumValues: string[] | null;
  isRequired: boolean;
  isKey: boolean;
  // Mapping info (if exists)
  mappingStatus: string | null;
  mappingType: string | null;
  confidence: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  reasoning: string | null;
  linearIssueId: string | null;
}

export const GET = withAuth(async (req, _ctx, { workspaceId }) => {
  const milestoneParam = req.nextUrl.searchParams.get("milestone");

  // Get all target fields with their entity info
  const targetEntities = await db.select().from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")));

  const entityById = new Map(targetEntities.map((e) => [e.id, e]));

  const allFields = (await db.select().from(field))
    .filter((f) => entityById.has(f.entityId));

  // Apply milestone filter
  const filtered = milestoneParam
    ? allFields.filter((f) => f.milestone === milestoneParam)
    : allFields;

  // Get latest mappings for all target fields
  const allMappings = await db.select().from(fieldMapping)
    .where(and(eq(fieldMapping.workspaceId, workspaceId), eq(fieldMapping.isLatest, true)));
  const mappingByFieldId = new Map(allMappings.map((m) => [m.targetFieldId, m]));

  // Resolve source entity/field names
  const allEntities = await db.select().from(entity)
    ;
  const entityNameById = new Map(allEntities.map((e) => [e.id, e.displayName || e.name]));
  const allFieldsLookup = await db.select().from(field)
    ;
  const fieldNameById = new Map(allFieldsLookup.map((f) => [f.id, f.displayName || f.name]));

  const rows: FieldRow[] = filtered.map((f) => {
    const ent = entityById.get(f.entityId)!;
    const m = mappingByFieldId.get(f.id);
    const meta = f.metadata as Record<string, unknown> | null;

    return {
      fieldId: f.id,
      fieldName: f.displayName || f.name,
      entityId: ent.id,
      entityName: ent.displayName || ent.name,
      dataType: f.dataType,
      description: f.description,
      milestone: f.milestone,
      enumValues: f.enumValues as string[] | null,
      isRequired: !!f.isRequired,
      isKey: !!f.isKey,
      mappingStatus: m?.status ?? null,
      mappingType: m?.mappingType ?? null,
      confidence: m?.confidence ?? null,
      sourceEntityName: m?.sourceEntityId ? (entityNameById.get(m.sourceEntityId) ?? null) : null,
      sourceFieldName: m?.sourceFieldId ? (fieldNameById.get(m.sourceFieldId) ?? null) : null,
      transform: m?.transform ?? null,
      reasoning: m?.reasoning ?? null,
      linearIssueId: meta?.linearIssueId as string | null ?? null,
    };
  });

  // Sort by entity name, then field name
  rows.sort((a, b) => a.entityName.localeCompare(b.entityName) || a.fieldName.localeCompare(b.fieldName));

  return NextResponse.json(rows);
});
