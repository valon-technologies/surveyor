import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { entity, field, fieldMapping } from "@/lib/db/schema";
import { eq, and, like, count, sql } from "drizzle-orm";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const side = searchParams.get("side");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  // Build conditions
  const conditions = [eq(entity.workspaceId, workspaceId)];
  if (side) conditions.push(eq(entity.side, side));
  if (status) conditions.push(eq(entity.status, status));
  if (search) conditions.push(like(entity.name, `%${search}%`));

  const entities = await db
    .select()
    .from(entity)
    .where(and(...conditions))
    .orderBy(entity.sortOrder);

  // Add field counts and status breakdown
  const result = [];
  for (const ent of entities) {
    const fields = await db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, ent.id));

    const fieldIds = fields.map((f) => f.id);
    const statusBreakdown: Record<string, number> = {};

    if (fieldIds.length > 0) {
      const rows = await db
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

      for (const r of rows) {
        statusBreakdown[r.status] = r.cnt;
      }
    }

    result.push({
      ...ent,
      fieldCount: fields.length,
      statusBreakdown,
    });
  }

  return NextResponse.json(result);
});
