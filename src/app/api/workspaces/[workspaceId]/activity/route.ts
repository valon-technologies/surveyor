import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { activity } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const GET = withAuth(async (req, _ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const fieldMappingId = searchParams.get("fieldMappingId");
  const entityId = searchParams.get("entityId");

  const conditions = [eq(activity.workspaceId, workspaceId)];
  if (fieldMappingId) conditions.push(eq(activity.fieldMappingId, fieldMappingId));
  if (entityId) conditions.push(eq(activity.entityId, entityId));

  const items = await db
    .select()
    .from(activity)
    .where(and(...conditions))
    .orderBy(desc(activity.createdAt))
    .limit(100);

  return NextResponse.json(items);
});
