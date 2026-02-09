import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { entity, field, fieldMapping, question } from "@/lib/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { updateEntitySchema } from "@/lib/validators/entity";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  const ent = db
    .select()
    .from(entity)
    .where(and(eq(entity.id, id), eq(entity.workspaceId, workspaceId)))
    .get();

  if (!ent) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  // Get fields with their latest mappings
  const fields = db.select().from(field).where(eq(field.entityId, id)).orderBy(field.sortOrder).all();

  const fieldsWithMappings = fields.map((f) => {
    const mapping = db
      .select()
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.targetFieldId, f.id),
          eq(fieldMapping.isLatest, true)
        )
      )
      .get();

    // If we have a mapping with source field, get the source names
    let sourceEntityName: string | undefined;
    let sourceFieldName: string | undefined;
    if (mapping?.sourceFieldId) {
      const sf = db.select().from(field).where(eq(field.id, mapping.sourceFieldId)).get();
      if (sf) {
        sourceFieldName = sf.name;
        const se = db.select().from(entity).where(eq(entity.id, sf.entityId)).get();
        sourceEntityName = se?.name;
      }
    } else if (mapping?.sourceEntityId) {
      const se = db.select().from(entity).where(eq(entity.id, mapping.sourceEntityId)).get();
      sourceEntityName = se?.name;
    }

    return {
      ...f,
      mapping: mapping
        ? {
            id: mapping.id,
            status: mapping.status,
            sourceEntityId: mapping.sourceEntityId,
            sourceFieldId: mapping.sourceFieldId,
            sourceEntityName,
            sourceFieldName,
            transform: mapping.transform,
            defaultValue: mapping.defaultValue,
            confidence: mapping.confidence,
            createdBy: mapping.createdBy,
          }
        : null,
    };
  });

  // Stats
  const openQs = db
    .select({ cnt: count() })
    .from(question)
    .where(and(eq(question.entityId, id), eq(question.status, "open")))
    .get();

  const mappedCount = fieldsWithMappings.filter(
    (f) => f.mapping && f.mapping.status !== "unmapped"
  ).length;

  return NextResponse.json({
    ...ent,
    fields: fieldsWithMappings,
    fieldCount: fields.length,
    mappedCount,
    unmappedCount: fields.length - mappedCount,
    coveragePercent: fields.length > 0 ? Math.round((mappedCount / fields.length) * 100) : 0,
    openQuestions: openQs?.cnt || 0,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const body = await req.json();
  const parsed = updateEntitySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = db
    .update(entity)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(entity.id, id), eq(entity.workspaceId, workspaceId)))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
