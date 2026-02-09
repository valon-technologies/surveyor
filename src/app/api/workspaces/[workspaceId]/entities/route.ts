import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { entity, field } from "@/lib/db/schema";
import { eq, and, like, count } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const searchParams = req.nextUrl.searchParams;
  const side = searchParams.get("side");
  const status = searchParams.get("status");
  const tier = searchParams.get("tier");
  const search = searchParams.get("search");

  let query = db
    .select()
    .from(entity)
    .where(eq(entity.workspaceId, workspaceId))
    .$dynamic();

  // Build conditions
  const conditions = [eq(entity.workspaceId, workspaceId)];
  if (side) conditions.push(eq(entity.side, side));
  if (status) conditions.push(eq(entity.status, status));
  if (tier) conditions.push(eq(entity.priorityTier, tier));
  if (search) conditions.push(like(entity.name, `%${search}%`));

  const entities = db
    .select()
    .from(entity)
    .where(and(...conditions))
    .orderBy(entity.sortOrder)
    .all();

  // Add field counts
  const result = entities.map((ent) => {
    const fieldCount = db
      .select({ cnt: count() })
      .from(field)
      .where(eq(field.entityId, ent.id))
      .get();

    return { ...ent, fieldCount: fieldCount?.cnt || 0 };
  });

  return NextResponse.json(result);
}
