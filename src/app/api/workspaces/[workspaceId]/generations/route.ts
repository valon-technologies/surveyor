import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const searchParams = req.nextUrl.searchParams;
  const entityId = searchParams.get("entityId");

  const conditions = [eq(generation.workspaceId, workspaceId)];
  if (entityId) conditions.push(eq(generation.entityId, entityId));

  const generations = db
    .select()
    .from(generation)
    .where(and(...conditions))
    .orderBy(generation.createdAt)
    .all();

  return NextResponse.json(generations);
}
