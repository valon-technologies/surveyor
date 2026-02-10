import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity } from "@/lib/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import type { ReviewCardData } from "@/types/review";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const reviewStatus = searchParams.get("reviewStatus");
  const confidence = searchParams.get("confidence");
  const entityId = searchParams.get("entityId");
  const sortBy = searchParams.get("sortBy") || "createdAt";
  const sortOrder = searchParams.get("sortOrder") || "desc";

  // Query all latest LLM-generated mappings
  const conditions = [
    eq(fieldMapping.workspaceId, workspaceId),
    eq(fieldMapping.isLatest, true),
  ];

  const mappings = await db
    .select()
    .from(fieldMapping)
    .where(and(...conditions));

  // Load field + entity data for each mapping
  const cards: ReviewCardData[] = [];

  for (const m of mappings) {
    const targetField = (await db
      .select()
      .from(field)
      .where(eq(field.id, m.targetFieldId)))[0];
    if (!targetField) continue;

    const targetEntity = (await db
      .select()
      .from(entity)
      .where(eq(entity.id, targetField.entityId)))[0];
    if (!targetEntity) continue;

    // Apply filters
    if (reviewStatus && m.reviewStatus !== reviewStatus) continue;
    if (confidence && m.confidence !== confidence) continue;
    if (entityId && targetEntity.id !== entityId) continue;

    // Resolve source names
    let sourceEntityName: string | null = null;
    let sourceFieldName: string | null = null;

    if (m.sourceEntityId) {
      const se = (await db.select().from(entity).where(eq(entity.id, m.sourceEntityId)))[0];
      sourceEntityName = se?.displayName || se?.name || null;
    }
    if (m.sourceFieldId) {
      const sf = (await db.select().from(field).where(eq(field.id, m.sourceFieldId)))[0];
      sourceFieldName = sf?.displayName || sf?.name || null;
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
      status: m.status as ReviewCardData["status"],
      reviewStatus: m.reviewStatus as ReviewCardData["reviewStatus"],
      mappingType: m.mappingType as ReviewCardData["mappingType"],
      confidence: m.confidence as ReviewCardData["confidence"],
      sourceEntityName,
      sourceFieldName,
      transform: m.transform,
      defaultValue: m.defaultValue,
      reasoning: m.reasoning,
      notes: m.notes,
      puntNote: m.puntNote ?? null,
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
