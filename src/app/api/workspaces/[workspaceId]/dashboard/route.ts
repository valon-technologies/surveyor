import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { entity, field, fieldMapping, question } from "@/lib/db/schema";
import { eq, and, sql, count } from "drizzle-orm";
import { MILESTONES } from "@/lib/constants";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  // Get all target entities with field counts and mapping stats
  const entities = await db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .orderBy(entity.sortOrder);

  // Get field counts and mapping stats per entity
  const entityStats = await Promise.all(entities.map(async (e) => {
    const fields = await db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, e.id));

    const fieldIds = fields.map((f) => f.id);
    const statusCounts: Record<string, number> = {};

    if (fieldIds.length > 0) {
      const mappings = await db
        .select({
          status: sql<string>`COALESCE(${fieldMapping.status}, 'unmapped')`,
          cnt: count(),
        })
        .from(field)
        .leftJoin(
          fieldMapping,
          and(
            eq(fieldMapping.targetFieldId, field.id),
            eq(fieldMapping.isLatest, true)
          )
        )
        .where(
          sql`${field.id} IN (${sql.join(
            fieldIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )
        .groupBy(sql`COALESCE(${fieldMapping.status}, 'unmapped')`);

      for (const m of mappings) {
        statusCounts[m.status] = m.cnt;
      }
    }

    const mappedCount = statusCounts["fully_closed"] || 0;

    const openQs = (await db
      .select({ cnt: count() })
      .from(question)
      .where(and(eq(question.entityId, e.id), eq(question.status, "open"))))[0];

    return {
      id: e.id,
      name: e.name,
      displayName: e.displayName,
      status: e.status,
      fieldCount: fields.length,
      mappedCount,
      unmappedCount: fields.length - mappedCount,
      coveragePercent:
        fields.length > 0
          ? Math.round((mappedCount / fields.length) * 100)
          : 0,
      openQuestions: openQs?.cnt || 0,
      statusBreakdown: statusCounts,
    };
  }));

  // Milestone stats: per-milestone status breakdown across all target fields
  const milestoneStats = await Promise.all(MILESTONES.map(async (m) => {
    const rows = await db
      .select({
        status: sql<string>`COALESCE(${fieldMapping.status}, 'unmapped')`,
        cnt: count(),
      })
      .from(field)
      .innerJoin(entity, eq(field.entityId, entity.id))
      .leftJoin(
        fieldMapping,
        and(
          eq(fieldMapping.targetFieldId, field.id),
          eq(fieldMapping.isLatest, true)
        )
      )
      .where(
        and(
          eq(entity.workspaceId, workspaceId),
          eq(entity.side, "target"),
          eq(field.milestone, m)
        )
      )
      .groupBy(sql`COALESCE(${fieldMapping.status}, 'unmapped')`);

    const statusBreakdown: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      statusBreakdown[r.status] = r.cnt;
      total += r.cnt;
    }

    const mapped = statusBreakdown["fully_closed"] || 0;

    return {
      milestone: m,
      totalFields: total,
      mappedFields: mapped,
      coveragePercent: total > 0 ? Math.round((mapped / total) * 100) : 0,
      statusBreakdown,
    };
  }));

  // Aggregate stats
  const totalFields = entityStats.reduce((sum, e) => sum + e.fieldCount, 0);
  const mappedFields = entityStats.reduce((sum, e) => sum + e.mappedCount, 0);

  // Status distribution across ALL target fields (including unmapped)
  const allFieldStatuses = await db
    .select({
      status: sql<string>`COALESCE(${fieldMapping.status}, 'unmapped')`,
      cnt: count(),
    })
    .from(field)
    .innerJoin(entity, eq(field.entityId, entity.id))
    .leftJoin(
      fieldMapping,
      and(
        eq(fieldMapping.targetFieldId, field.id),
        eq(fieldMapping.isLatest, true)
      )
    )
    .where(
      and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target"))
    )
    .groupBy(sql`COALESCE(${fieldMapping.status}, 'unmapped')`);

  const statusDistribution: Record<string, number> = {};
  for (const r of allFieldStatuses) {
    statusDistribution[r.status] = r.cnt;
  }

  const openQuestions = (await db
    .select({ cnt: count() })
    .from(question)
    .where(
      and(eq(question.workspaceId, workspaceId), eq(question.status, "open"))
    ))[0];

  return NextResponse.json({
    totalEntities: entities.length,
    totalFields,
    mappedFields,
    coveragePercent:
      totalFields > 0 ? Math.round((mappedFields / totalFields) * 100) : 0,
    openQuestions: openQuestions?.cnt || 0,
    entities: entityStats,
    milestoneStats,
    statusDistribution,
  });
});
