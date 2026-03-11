import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity, transfer } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { VerdictHistoryItem } from "@/types/review";

export const GET = withAuth(async (_req, _ctx, { userId, workspaceId }) => {
  // Load all latest mappings where this user is the assignee and a review action was taken
  const reviewedStatuses = ["accepted", "excluded", "punted", "needs_discussion"];
  const myMappings = await db
    .select()
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.assigneeId, userId),
        eq(fieldMapping.isLatest, true),
        inArray(fieldMapping.status, reviewedStatuses),
      ),
    );

  if (myMappings.length === 0) {
    return NextResponse.json([]);
  }

  // Batch-load target fields
  const targetFieldIds = [...new Set(myMappings.map((m) => m.targetFieldId))];
  const allFields = await db.select().from(field).where(inArray(field.id, targetFieldIds));
  const fieldById = new Map(allFields.map((f) => [f.id, f]));

  // Batch-load entities (target + source)
  const entityIds = [...new Set([
    ...allFields.map((f) => f.entityId),
    ...myMappings.map((m) => m.sourceEntityId).filter(Boolean) as string[],
  ])];
  const allEntities = entityIds.length > 0
    ? await db.select().from(entity).where(inArray(entity.id, entityIds))
    : [];
  const entityById = new Map(allEntities.map((e) => [e.id, e]));

  // Batch-load source fields
  const sourceFieldIds = [...new Set(myMappings.map((m) => m.sourceFieldId).filter(Boolean) as string[])];
  const allSourceFields = sourceFieldIds.length > 0
    ? await db.select().from(field).where(inArray(field.id, sourceFieldIds))
    : [];
  const sourceFieldById = new Map(allSourceFields.map((f) => [f.id, f]));

  // Batch-load transfers
  const transferIds = [...new Set(myMappings.map((m) => m.transferId).filter(Boolean) as string[])];
  const allTransfers = transferIds.length > 0
    ? await db.select({ id: transfer.id, name: transfer.name }).from(transfer).where(inArray(transfer.id, transferIds))
    : [];
  const transferById = new Map(allTransfers.map((t) => [t.id, t]));

  // Build result
  const items: VerdictHistoryItem[] = [];
  for (const m of myMappings) {
    const targetField = fieldById.get(m.targetFieldId);
    if (!targetField) continue;

    const targetEntity = entityById.get(targetField.entityId);
    const sourceField = m.sourceFieldId ? sourceFieldById.get(m.sourceFieldId) : null;
    const sourceEntity = m.sourceEntityId ? entityById.get(m.sourceEntityId) : null;
    const t = m.transferId ? transferById.get(m.transferId) : null;

    items.push({
      id: m.id,
      targetFieldName: targetField.displayName || targetField.name,
      targetFieldDataType: targetField.dataType,
      entityName: targetEntity?.displayName || targetEntity?.name || "Unknown",
      status: m.status as VerdictHistoryItem["status"],
      sourceVerdict: m.sourceVerdict,
      transformVerdict: m.transformVerdict,
      sourceFieldName: sourceField?.displayName || sourceField?.name || null,
      sourceEntityName: sourceEntity?.displayName || sourceEntity?.name || null,
      transferId: m.transferId,
      transferName: t?.name || null,
      mappingType: m.mappingType as VerdictHistoryItem["mappingType"],
      confidence: m.confidence as VerdictHistoryItem["confidence"],
      notes: m.notes,
      updatedAt: m.updatedAt || m.createdAt,
    });
  }

  // Sort by most recent first
  items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  return NextResponse.json(items);
}, { requiredRole: "editor" });
