import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity, user } from "@/lib/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import type { ReviewCardData } from "@/types/review";

export const GET = withAuth(async (req, _ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const statusFilter = searchParams.get("status");
  const confidence = searchParams.get("confidence");
  const entityId = searchParams.get("entityId");
  const transferId = searchParams.get("transferId");
  const sortBy = searchParams.get("sortBy") || "confidence";
  const sortOrder = searchParams.get("sortOrder") || "desc";

  // 1. Load all latest mappings in one query
  // When transferId is provided, scope to that transfer.
  // Otherwise, exclude transfer mappings (VDS Review only).
  const transferFilter = transferId
    ? eq(fieldMapping.transferId, transferId)
    : isNull(fieldMapping.transferId);

  const allMappings = await db
    .select()
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true),
        transferFilter,
      ),
    );

  // Deduplicate by targetFieldId
  const byTarget = new Map<string, typeof allMappings[number]>();
  for (const m of allMappings) {
    const existing = byTarget.get(m.targetFieldId);
    if (!existing || m.createdAt > existing.createdAt) {
      byTarget.set(m.targetFieldId, m);
    }
  }
  const mappings = Array.from(byTarget.values());

  // 2. Batch-load all target fields
  const targetFieldIds = [...new Set(mappings.map((m) => m.targetFieldId))];
  const allFields = targetFieldIds.length > 0
    ? await db.select().from(field).where(inArray(field.id, targetFieldIds))
    : [];
  const fieldById = new Map(allFields.map((f) => [f.id, f]));

  // 3. Batch-load all entities
  const entityIds = [...new Set([
    ...allFields.map((f) => f.entityId),
    ...mappings.map((m) => m.sourceEntityId).filter(Boolean) as string[],
  ])];
  const allEntities = entityIds.length > 0
    ? await db.select().from(entity).where(inArray(entity.id, entityIds))
    : [];
  const entityById = new Map(allEntities.map((e) => [e.id, e]));

  // Also load parent entities
  const parentIds = [...new Set(allEntities.map((e) => e.parentEntityId).filter(Boolean) as string[])];
  if (parentIds.length > 0) {
    const parents = await db.select().from(entity).where(inArray(entity.id, parentIds));
    for (const p of parents) entityById.set(p.id, p);
  }

  // 4. Batch-load source fields
  const sourceFieldIds = [...new Set(mappings.map((m) => m.sourceFieldId).filter(Boolean) as string[])];
  const allSourceFields = sourceFieldIds.length > 0
    ? await db.select().from(field).where(inArray(field.id, sourceFieldIds))
    : [];
  const sourceFieldById = new Map(allSourceFields.map((f) => [f.id, f]));

  // 5. Batch-load assignees
  const assigneeIds = [...new Set(mappings.map((m) => m.assigneeId).filter(Boolean) as string[])];
  const allAssignees = assigneeIds.length > 0
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, assigneeIds))
    : [];
  const assigneeById = new Map(allAssignees.map((u) => [u.id, u]));

  // 6. Build cards (no additional queries)
  const cards: ReviewCardData[] = [];

  for (const m of mappings) {
    const targetField = fieldById.get(m.targetFieldId);
    if (!targetField) continue;

    const targetEntity = entityById.get(targetField.entityId);
    if (!targetEntity) continue;

    // Apply filters
    if (statusFilter && m.status !== statusFilter) continue;
    if (confidence && m.confidence !== confidence) continue;
    if (entityId && targetEntity.id !== entityId && targetEntity.parentEntityId !== entityId) continue;

    const parentEntity = targetEntity.parentEntityId ? entityById.get(targetEntity.parentEntityId) : null;
    const sourceEntity = m.sourceEntityId ? entityById.get(m.sourceEntityId) : null;
    const sourceField = m.sourceFieldId ? sourceFieldById.get(m.sourceFieldId) : null;
    const assignee = m.assigneeId ? assigneeById.get(m.assigneeId) : null;

    cards.push({
      id: m.id,
      targetFieldId: m.targetFieldId,
      targetFieldName: targetField.displayName || targetField.name,
      targetFieldDescription: targetField.description,
      targetFieldDataType: targetField.dataType,
      milestone: targetField.milestone,
      entityId: targetEntity.id,
      entityName: targetEntity.displayName || targetEntity.name,
      entityMetadata: targetEntity.metadata ?? null,
      parentEntityId: targetEntity.parentEntityId ?? null,
      parentEntityName: parentEntity?.displayName || parentEntity?.name || null,
      status: m.status as ReviewCardData["status"],
      mappingType: m.mappingType as ReviewCardData["mappingType"],
      confidence: m.confidence as ReviewCardData["confidence"],
      sourceEntityId: m.sourceEntityId ?? null,
      sourceFieldId: m.sourceFieldId ?? null,
      sourceEntityName: sourceEntity?.displayName || sourceEntity?.name || null,
      sourceFieldName: sourceField?.displayName || sourceField?.name || null,
      transform: m.transform,
      defaultValue: m.defaultValue,
      reasoning: m.reasoning,
      reviewComment: m.notes,
      notes: m.notes,
      puntNote: m.puntNote ?? null,
      excludeReason: m.excludeReason ?? null,
      assigneeId: m.assigneeId ?? null,
      assigneeName: assignee?.name ?? null,
      createdBy: m.createdBy,
      batchRunId: m.batchRunId ?? null,
      createdAt: m.createdAt,
    });
  }

  // Sort
  cards.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "confidence": {
        const order = { low: 0, medium: 1, high: 2 };
        cmp = (order[a.confidence ?? "medium"] ?? 1) - (order[b.confidence ?? "medium"] ?? 1);
        break;
      }
      case "entityName":
        cmp = a.entityName.localeCompare(b.entityName);
        break;
      case "targetFieldName":
        cmp = a.targetFieldName.localeCompare(b.targetFieldName);
        break;
      case "createdAt":
      default:
        cmp = a.createdAt.localeCompare(b.createdAt);
        break;
    }
    return sortOrder === "asc" ? cmp : -cmp;
  });

  return NextResponse.json(cards);
});
