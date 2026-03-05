import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db, withTransaction } from "@/lib/db";
import { fieldMapping, mappingContext, field, entity, context, userWorkspace, entityPipeline } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateMappingSchema } from "@/lib/validators/mapping";
import { logActivity } from "@/lib/activity/log-activity";
import { computeStatusOnSave } from "@/lib/status/status-engine";
import { extractMappingLearning } from "@/lib/generation/mapping-learning";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  const mapping = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
)[0];

  if (!mapping) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  // Get target field info
  const [targetField] = await db.select().from(field).where(eq(field.id, mapping.targetFieldId)).limit(1);
  const targetEntity = targetField
    ? (await db.select().from(entity).where(eq(entity.id, targetField.entityId)).limit(1))[0]
    : null;

  // Get source field info
  let sourceField = null;
  if (mapping.sourceFieldId) {
    const [sf] = await db.select().from(field).where(eq(field.id, mapping.sourceFieldId)).limit(1);
    if (sf) {
      const [se] = await db.select().from(entity).where(eq(entity.id, sf.entityId)).limit(1);
      sourceField = { ...sf, entityName: se?.name };
    }
  }

  // Get contexts
  const contexts = await db
    .select()
    .from(mappingContext)
    .where(eq(mappingContext.fieldMappingId, id))
    ;

  const contextsWithNames = [];
  for (const c of contexts) {
    let contextName: string | undefined;
    if (c.contextId) {
      const [cDoc] = await db.select({ name: context.name }).from(context).where(eq(context.id, c.contextId)).limit(1);
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
          description: targetField.description,
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
    console.error("[PATCH mapping] Validation failed:", parsed.error.message, "Body:", JSON.stringify(body));
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { editedBy, ...updateData } = parsed.data;

  // Resolve source entity/field names to IDs if provided (from AI review proposals)
  const bodyAny = body as Record<string, unknown>;
  if (bodyAny.sourceEntityName && !updateData.sourceEntityId) {
    const matchName = (a: string, b: string) => a.toLowerCase().replace(/[_\s]/g, "") === b.toLowerCase().replace(/[_\s]/g, "");
    const se = (await db.select({ id: entity.id, name: entity.name }).from(entity)
      .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
      ).find(e => matchName(e.name, String(bodyAny.sourceEntityName)));
    if (se) {
      updateData.sourceEntityId = se.id;
      if (bodyAny.sourceFieldName && !updateData.sourceFieldId) {
        const sf = (await db.select({ id: field.id, name: field.name }).from(field)
          .where(eq(field.entityId, se.id))
          ).find(f => matchName(f.name, String(bodyAny.sourceFieldName)));
        if (sf) updateData.sourceFieldId = sf.id;
      }
    }
  }

  // Transaction: read existing + mark-old + insert-new (prevents duplicate isLatest)
  const txResult = await withTransaction(async () => {
    const existing = (await db
      .select()
      .from(fieldMapping)
      .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
      )[0];

    if (!existing) return null;

    // Use client-provided status if explicitly set, otherwise auto-compute
    const finalStatus = updateData.status ?? computeStatusOnSave(existing.status);

    // Auto-assign the acting user when status changes to a reviewed state
    if (finalStatus !== existing.status && updateData.assigneeId === undefined) {
      updateData.assigneeId = userId;
    }

    // Generate change summary
    const changeSummary = generateChangeSummary(
      existing as unknown as Record<string, unknown>,
      { ...updateData, status: finalStatus } as Record<string, unknown>
    );

    // Get target field for entity context
    const [targetField] = await db.select().from(field).where(eq(field.id, existing.targetFieldId)).limit(1);

    // Mark existing version as not latest
    await db.update(fieldMapping)
      .set({ isLatest: false, updatedAt: new Date().toISOString() })
      .where(eq(fieldMapping.id, id))
      ;

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
      .returning()
      ;

    // Mark entity pipeline as stale
    if (targetField?.entityId) {
      await db.update(entityPipeline)
        .set({ isStale: true, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(entityPipeline.entityId, targetField.entityId),
            eq(entityPipeline.isLatest, true)
          )
        )
        ;
    }

    return { newVersion, existing, targetField, finalStatus: finalStatus as string, changeSummary };
  });

  if (!txResult) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const { newVersion, existing, targetField, finalStatus, changeSummary } = txResult;
  const actorName = editedBy || "Unknown";

  // Log mapping_saved activity
  logActivity({
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
    logActivity({
      workspaceId,
      fieldMappingId: newVersion.id,
      entityId: targetField?.entityId || null,
      actorId: userId,
      actorName,
      action: "status_change",
      detail: { from: existing.status, to: finalStatus },
    });
  }

  // Auto-create learning from significant mapping corrections
  extractMappingLearning(
    {
      sourceEntityId: existing.sourceEntityId,
      sourceFieldId: existing.sourceFieldId,
      mappingType: existing.mappingType,
      transform: existing.transform,
      status: existing.status,
    },
    {
      sourceEntityId: newVersion.sourceEntityId,
      sourceFieldId: newVersion.sourceFieldId,
      mappingType: newVersion.mappingType,
      transform: newVersion.transform,
      status: newVersion.status,
    },
    { workspaceId, targetFieldId: existing.targetFieldId },
  );

  return NextResponse.json(newVersion);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  await db.delete(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
    ;

  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
