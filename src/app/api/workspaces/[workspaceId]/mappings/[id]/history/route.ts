import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  // Get the mapping to find its targetFieldId
  const mapping = db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
    .get();

  if (!mapping) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  // Get all versions for the same targetFieldId
  const history = db
    .select({
      id: fieldMapping.id,
      version: fieldMapping.version,
      status: fieldMapping.status,
      mappingType: fieldMapping.mappingType,
      assigneeId: fieldMapping.assigneeId,
      editedBy: fieldMapping.editedBy,
      changeSummary: fieldMapping.changeSummary,
      createdBy: fieldMapping.createdBy,
      isLatest: fieldMapping.isLatest,
      createdAt: fieldMapping.createdAt,
    })
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.targetFieldId, mapping.targetFieldId),
        eq(fieldMapping.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(fieldMapping.version))
    .all();

  return NextResponse.json(history);
});
