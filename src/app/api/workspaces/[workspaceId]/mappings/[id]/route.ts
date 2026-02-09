import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fieldMapping, mappingContext, field, entity, context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateMappingSchema } from "@/lib/validators/mapping";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  const mapping = db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
    .get();

  if (!mapping) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  // Get target field info
  const targetField = db.select().from(field).where(eq(field.id, mapping.targetFieldId)).get();
  const targetEntity = targetField
    ? db.select().from(entity).where(eq(entity.id, targetField.entityId)).get()
    : null;

  // Get source field info
  let sourceField = null;
  if (mapping.sourceFieldId) {
    const sf = db.select().from(field).where(eq(field.id, mapping.sourceFieldId)).get();
    if (sf) {
      const se = db.select().from(entity).where(eq(entity.id, sf.entityId)).get();
      sourceField = { ...sf, entityName: se?.name };
    }
  }

  // Get contexts
  const contexts = db
    .select()
    .from(mappingContext)
    .where(eq(mappingContext.fieldMappingId, id))
    .all();

  const contextsWithNames = contexts.map((ctx) => {
    let contextName: string | undefined;
    if (ctx.contextId) {
      const c = db.select({ name: context.name }).from(context).where(eq(context.id, ctx.contextId)).get();
      contextName = c?.name;
    }
    return { ...ctx, contextName };
  });

  return NextResponse.json({
    ...mapping,
    targetField: targetField
      ? {
          id: targetField.id,
          name: targetField.name,
          displayName: targetField.displayName,
          dataType: targetField.dataType,
          entityId: targetField.entityId,
          entityName: targetEntity?.name,
        }
      : null,
    sourceField,
    contexts: contextsWithNames,
  });
}

function generateChangeSummary(
  oldMapping: Record<string, unknown>,
  newData: Record<string, unknown>
): string {
  const changes: string[] = [];
  const fieldLabels: Record<string, string> = {
    status: "status",
    sourceEntityId: "source entity",
    sourceFieldId: "source field",
    transform: "transform",
    defaultValue: "default value",
    enumMapping: "enum mapping",
    reasoning: "reasoning",
    confidence: "confidence",
    notes: "notes",
  };

  for (const [key, label] of Object.entries(fieldLabels)) {
    if (key in newData) {
      const oldVal = oldMapping[key];
      const newVal = newData[key];
      // Compare serialized for objects
      const oldStr = typeof oldVal === "object" ? JSON.stringify(oldVal) : String(oldVal ?? "");
      const newStr = typeof newVal === "object" ? JSON.stringify(newVal) : String(newVal ?? "");
      if (oldStr !== newStr) {
        if (key === "status") {
          changes.push(`${label}: ${oldVal} → ${newVal}`);
        } else if (!oldVal && newVal) {
          changes.push(`added ${label}`);
        } else if (oldVal && !newVal) {
          changes.push(`cleared ${label}`);
        } else {
          changes.push(`updated ${label}`);
        }
      }
    }
  }

  return changes.length > 0 ? changes.join(", ") : "no changes detected";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const body = await req.json();
  const parsed = updateMappingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const existing = db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const { editedBy, ...updateData } = parsed.data;

  // Generate change summary
  const changeSummary = generateChangeSummary(
    existing as unknown as Record<string, unknown>,
    updateData as Record<string, unknown>
  );

  // Mark existing version as not latest
  db.update(fieldMapping)
    .set({ isLatest: false, updatedAt: new Date().toISOString() })
    .where(eq(fieldMapping.id, id))
    .run();

  // Create new version (copy-on-write)
  const [newVersion] = db
    .insert(fieldMapping)
    .values({
      workspaceId: existing.workspaceId,
      targetFieldId: existing.targetFieldId,
      status: updateData.status ?? existing.status,
      sourceEntityId: updateData.sourceEntityId !== undefined ? updateData.sourceEntityId : existing.sourceEntityId,
      sourceFieldId: updateData.sourceFieldId !== undefined ? updateData.sourceFieldId : existing.sourceFieldId,
      transform: updateData.transform !== undefined ? updateData.transform : existing.transform,
      defaultValue: updateData.defaultValue !== undefined ? updateData.defaultValue : existing.defaultValue,
      enumMapping: updateData.enumMapping !== undefined ? updateData.enumMapping : existing.enumMapping,
      reasoning: updateData.reasoning !== undefined ? updateData.reasoning : existing.reasoning,
      confidence: updateData.confidence !== undefined ? updateData.confidence : existing.confidence,
      notes: updateData.notes !== undefined ? updateData.notes : existing.notes,
      createdBy: existing.createdBy,
      generationId: existing.generationId,
      version: existing.version + 1,
      parentId: existing.id,
      isLatest: true,
      editedBy: editedBy || null,
      changeSummary,
    })
    .returning()
    .all();

  return NextResponse.json(newVersion);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  db.delete(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
    .run();

  return NextResponse.json({ success: true });
}
