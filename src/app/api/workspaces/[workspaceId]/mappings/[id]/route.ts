import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, mappingContext, field, entity, context, userWorkspace } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateMappingSchema } from "@/lib/validators/mapping";
import { logActivity } from "@/lib/activity/log-activity";
import { computeStatusOnSave } from "@/lib/status/status-engine";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  const mapping = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId))))[0];

  if (!mapping) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  // Get target field info
  const targetField = (await db.select().from(field).where(eq(field.id, mapping.targetFieldId)))[0];
  const targetEntity = targetField
    ? (await db.select().from(entity).where(eq(entity.id, targetField.entityId)))[0]
    : null;

  // Get source field info
  let sourceField = null;
  if (mapping.sourceFieldId) {
    const sf = (await db.select().from(field).where(eq(field.id, mapping.sourceFieldId)))[0];
    if (sf) {
      const se = (await db.select().from(entity).where(eq(entity.id, sf.entityId)))[0];
      sourceField = { ...sf, entityName: se?.name };
    }
  }

  // Get contexts
  const contexts = await db
    .select()
    .from(mappingContext)
    .where(eq(mappingContext.fieldMappingId, id));

  const contextsWithNames = [];
  for (const c of contexts) {
    let contextName: string | undefined;
    if (c.contextId) {
      const cDoc = (await db.select({ name: context.name }).from(context).where(eq(context.id, c.contextId)))[0];
      contextName = cDoc?.name;
    }
    contextsWithNames.push({ ...c, contextName });
  }

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
});

function generateChangeSummary(
  oldMapping: Record<string, unknown>,
  newData: Record<string, unknown>
): string {
  const changes: string[] = [];
  const fieldLabels: Record<string, string> = {
    status: "status",
    mappingType: "mapping type",
    assigneeId: "assignee",
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

export const PATCH = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;
  const body = await req.json();
  const parsed = updateMappingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const existing = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId))))[0];

  if (!existing) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const { editedBy, ...updateData } = parsed.data;

  // Auto-compute status on save (ignore client-provided status)
  const autoStatus = computeStatusOnSave(existing.status);
  const finalStatus = autoStatus;

  // Generate change summary
  const changeSummary = generateChangeSummary(
    existing as unknown as Record<string, unknown>,
    { ...updateData, status: finalStatus } as Record<string, unknown>
  );

  // Get target field for entity context
  const targetField = (await db.select().from(field).where(eq(field.id, existing.targetFieldId)))[0];

  // Mark existing version as not latest
  await db.update(fieldMapping)
    .set({ isLatest: false, updatedAt: new Date().toISOString() })
    .where(eq(fieldMapping.id, id));

  // Create new version (copy-on-write)
  const [newVersion] = await db
    .insert(fieldMapping)
    .values({
      workspaceId: existing.workspaceId,
      targetFieldId: existing.targetFieldId,
      status: finalStatus,
      mappingType: updateData.mappingType !== undefined ? updateData.mappingType : existing.mappingType,
      assigneeId: updateData.assigneeId !== undefined ? updateData.assigneeId : existing.assigneeId,
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
    .returning();

  const actorName = editedBy || "Unknown";

  // Log mapping_saved activity
  await logActivity({
    workspaceId,
    fieldMappingId: newVersion.id,
    entityId: targetField?.entityId || null,
    actorId: userId,
    actorName,
    action: "mapping_saved",
    detail: { changeSummary, version: newVersion.version },
  });

  // Log status_change if status changed
  if (finalStatus !== existing.status) {
    await logActivity({
      workspaceId,
      fieldMappingId: newVersion.id,
      entityId: targetField?.entityId || null,
      actorId: userId,
      actorName,
      action: "status_change",
      detail: { from: existing.status, to: finalStatus },
    });
  }

  return NextResponse.json(newVersion);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  await db.delete(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)));

  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
