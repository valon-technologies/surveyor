import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  // Get the mapping to find its targetFieldId
  const mapping = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
)[0];

  if (!mapping) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  // Get all versions for the same targetFieldId + transferId scope
  const transferFilter = mapping.transferId
    ? eq(fieldMapping.transferId, mapping.transferId)
    : undefined;

  const conditions = [
    eq(fieldMapping.targetFieldId, mapping.targetFieldId),
    eq(fieldMapping.workspaceId, workspaceId),
  ];
  if (transferFilter) conditions.push(transferFilter);

  const history = await db
    .select({
      id: fieldMapping.id,
      version: fieldMapping.version,
      status: fieldMapping.status,
      mappingType: fieldMapping.mappingType,
      confidence: fieldMapping.confidence,
      transform: fieldMapping.transform,
      reasoning: fieldMapping.reasoning,
      notes: fieldMapping.notes,
      sourceVerdict: fieldMapping.sourceVerdict,
      sourceVerdictNotes: fieldMapping.sourceVerdictNotes,
      transformVerdict: fieldMapping.transformVerdict,
      transformVerdictNotes: fieldMapping.transformVerdictNotes,
      assigneeId: fieldMapping.assigneeId,
      editedBy: fieldMapping.editedBy,
      changeSummary: fieldMapping.changeSummary,
      createdBy: fieldMapping.createdBy,
      isLatest: fieldMapping.isLatest,
      createdAt: fieldMapping.createdAt,
    })
    .from(fieldMapping)
    .where(and(...conditions))
    .orderBy(desc(fieldMapping.version))
    ;

  return NextResponse.json(history);
});
