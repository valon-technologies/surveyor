import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { entity, field, fieldMapping, question } from "@/lib/db/schema";
import { eq, and, sql, count } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  // Get all target entities with field counts and mapping stats
  const entities = db
    .select({
      id: entity.id,
      name: entity.name,
      displayName: entity.displayName,
      side: entity.side,
      status: entity.status,
      priorityTier: entity.priorityTier,
      sortOrder: entity.sortOrder,
      schemaAssetId: entity.schemaAssetId,
      description: entity.description,
      metadata: entity.metadata,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      workspaceId: entity.workspaceId,
    })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .orderBy(entity.sortOrder)
    .all();

  // Get field counts and mapping stats per entity
  const entityStats = await Promise.all(
    entities.map((e) => {
      const fields = db
        .select({ id: field.id })
        .from(field)
        .where(eq(field.entityId, e.id))
        .all();

      const fieldIds = fields.map((f) => f.id);
      let mappedCount = 0;
      const statusCounts: Record<string, number> = {};

      if (fieldIds.length > 0) {
        const mappings = db
          .select({ status: fieldMapping.status })
          .from(fieldMapping)
          .where(
            and(
              eq(fieldMapping.workspaceId, workspaceId),
              eq(fieldMapping.isLatest, true),
              sql`${fieldMapping.targetFieldId} IN (${sql.join(
                fieldIds.map((id) => sql`${id}`),
                sql`, `
              )})`
            )
          )
          .all();

        for (const m of mappings) {
          statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
          if (m.status !== "unmapped") mappedCount++;
        }
      }

      const openQs = db
        .select({ cnt: count() })
        .from(question)
        .where(and(eq(question.entityId, e.id), eq(question.status, "open")))
        .get();

      return {
        ...e,
        fieldCount: fields.length,
        mappedCount,
        unmappedCount: fields.length - mappedCount,
        coveragePercent: fields.length > 0 ? Math.round((mappedCount / fields.length) * 100) : 0,
        openQuestions: openQs?.cnt || 0,
      };
    })
  );

  // Group by tier
  const entitiesByTier = {
    P0: entityStats.filter((e) => e.priorityTier === "P0"),
    P1: entityStats.filter((e) => e.priorityTier === "P1"),
    P2: entityStats.filter((e) => e.priorityTier === "P2"),
    unassigned: entityStats.filter((e) => !e.priorityTier),
  };

  // Aggregate stats
  const totalFields = entityStats.reduce((sum, e) => sum + e.fieldCount, 0);
  const mappedFields = entityStats.reduce((sum, e) => sum + e.mappedCount, 0);

  // Status distribution across all mappings
  const allMappings = db
    .select({ status: fieldMapping.status, cnt: count() })
    .from(fieldMapping)
    .where(and(eq(fieldMapping.workspaceId, workspaceId), eq(fieldMapping.isLatest, true)))
    .groupBy(fieldMapping.status)
    .all();

  const statusDistribution: Record<string, number> = {};
  for (const m of allMappings) {
    statusDistribution[m.status] = m.cnt;
  }

  const openQuestions = db
    .select({ cnt: count() })
    .from(question)
    .where(and(eq(question.workspaceId, workspaceId), eq(question.status, "open")))
    .get();

  return NextResponse.json({
    totalEntities: entities.length,
    totalFields,
    mappedFields,
    coveragePercent: totalFields > 0 ? Math.round((mappedFields / totalFields) * 100) : 0,
    openQuestions: openQuestions?.cnt || 0,
    entitiesByTier,
    statusDistribution,
  });
}
