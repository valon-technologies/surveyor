import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity, user } from "@/lib/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import type { ReviewCardData } from "@/types/review";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const statusFilter = searchParams.get("status");
  const confidence = searchParams.get("confidence");
  const entityId = searchParams.get("entityId");
  const sortBy = searchParams.get("sortBy") || "confidence";
  const sortOrder = searchParams.get("sortOrder") || "desc";

  // Query all latest LLM-generated mappings
  const conditions = [
    eq(fieldMapping.workspaceId, workspaceId),
    eq(fieldMapping.isLatest, true),
  ];

  const allMappings = db
    .select()
    .from(fieldMapping)
    .where(and(...conditions))
    .all();

  // Deduplicate by targetFieldId — keep only the most recent version
  const byTarget = new Map<string, typeof allMappings[number]>();
  for (const m of allMappings) {
    const existing = byTarget.get(m.targetFieldId);
    if (!existing || m.createdAt > existing.createdAt) {
      byTarget.set(m.targetFieldId, m);
    }
  }
  const mappings = Array.from(byTarget.values());

  // Load field + entity data for each mapping
  const cards: ReviewCardData[] = [];

  for (const m of mappings) {
    const targetField = db
      .select()
      .from(field)
      .where(eq(field.id, m.targetFieldId))
      .get();
    if (!targetField) continue;

    const targetEntity = db
      .select()
      .from(entity)
      .where(eq(entity.id, targetField.entityId))
      .get();
    if (!targetEntity) continue;

    // Apply filters
    if (statusFilter && m.status !== statusFilter) continue;
    if (confidence && m.confidence !== confidence) continue;
    if (entityId && targetEntity.id !== entityId && targetEntity.parentEntityId !== entityId) continue;

    // Resolve parent entity name
    let parentEntityName: string | null = null;
    if (targetEntity.parentEntityId) {
      const pe = db.select().from(entity).where(eq(entity.id, targetEntity.parentEntityId)).get();
      parentEntityName = pe?.displayName || pe?.name || null;
    }

    // Resolve source names
    let sourceEntityName: string | null = null;
    let sourceFieldName: string | null = null;

    if (m.sourceEntityId) {
      const se = db.select().from(entity).where(eq(entity.id, m.sourceEntityId)).get();
      sourceEntityName = se?.displayName || se?.name || null;
    }
    if (m.sourceFieldId) {
      const sf = db.select().from(field).where(eq(field.id, m.sourceFieldId)).get();
      sourceFieldName = sf?.displayName || sf?.name || null;
    }

    // Resolve assignee name
    let assigneeName: string | null = null;
    if (m.assigneeId) {
      const assignee = db.select({ name: user.name }).from(user).where(eq(user.id, m.assigneeId)).get();
      assigneeName = assignee?.name ?? null;
    }

    cards.push({
      id: m.id,
      targetFieldId: m.targetFieldId,
      targetFieldName: targetField.displayName || targetField.name,
      targetFieldDescription: targetField.description,
      targetFieldDataType: targetField.dataType,
      milestone: targetField.milestone,
      entityId: targetEntity.id,
      entityName: targetEntity.displayName || targetEntity.name,
      parentEntityId: targetEntity.parentEntityId ?? null,
      parentEntityName,
      status: m.status as ReviewCardData["status"],
      mappingType: m.mappingType as ReviewCardData["mappingType"],
      confidence: m.confidence as ReviewCardData["confidence"],
      sourceEntityId: m.sourceEntityId ?? null,
      sourceFieldId: m.sourceFieldId ?? null,
      sourceEntityName,
      sourceFieldName,
      transform: m.transform,
      defaultValue: m.defaultValue,
      reasoning: m.reasoning,
      reviewComment: m.notes,
      notes: m.notes,
      puntNote: m.puntNote ?? null,
      excludeReason: m.excludeReason ?? null,
      assigneeId: m.assigneeId ?? null,
      assigneeName,
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
