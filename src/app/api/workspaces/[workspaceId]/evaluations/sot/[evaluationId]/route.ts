import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { sotEvaluation, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET — Get detailed per-field results for a specific SOT evaluation
export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const evaluationId = params.evaluationId;

  if (!evaluationId) {
    return NextResponse.json({ error: "Missing evaluationId" }, { status: 400 });
  }

  const result = (await db
    .select({
      id: sotEvaluation.id,
      entityId: sotEvaluation.entityId,
      entityName: entity.name,
      generationId: sotEvaluation.generationId,
      batchRunId: sotEvaluation.batchRunId,
      totalFields: sotEvaluation.totalFields,
      scoredFields: sotEvaluation.scoredFields,
      sourceExactCount: sotEvaluation.sourceExactCount,
      sourceLenientCount: sotEvaluation.sourceLenientCount,
      sourceExactPct: sotEvaluation.sourceExactPct,
      sourceLenientPct: sotEvaluation.sourceLenientPct,
      fieldResults: sotEvaluation.fieldResults,
      createdAt: sotEvaluation.createdAt,
    })
    .from(sotEvaluation)
    .leftJoin(entity, eq(sotEvaluation.entityId, entity.id))
    .where(
      and(
        eq(sotEvaluation.id, evaluationId),
        eq(sotEvaluation.workspaceId, workspaceId),
      )
    )
    )[0];

  if (!result) {
    return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
  }

  return NextResponse.json(result);
});
