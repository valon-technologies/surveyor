import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { sotEvaluation, entity, fieldMapping, field } from "@/lib/db/schema";
import { eq, and, sql, desc, exists } from "drizzle-orm";
import { evaluateEntityMappings } from "@/lib/evaluation/mapping-evaluator";
import { listAvailableSotEntities } from "@/lib/evaluation/sot-loader";

// GET — List SOT evaluations with summary
export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const url = new URL(req.url);
  const entityId = url.searchParams.get("entityId");

  // Only return evals for entities that currently have generated mappings
  const hasMappings = exists(
    db.select({ one: sql`1` })
      .from(fieldMapping)
      .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
      .where(and(eq(field.entityId, sotEvaluation.entityId), eq(fieldMapping.isLatest, true)))
  );

  const conditions = [eq(sotEvaluation.workspaceId, workspaceId), hasMappings];
  if (entityId) {
    conditions.push(eq(sotEvaluation.entityId, entityId));
  }

  const evaluations = db
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
      createdAt: sotEvaluation.createdAt,
    })
    .from(sotEvaluation)
    .leftJoin(entity, eq(sotEvaluation.entityId, entity.id))
    .where(and(...conditions))
    .orderBy(desc(sotEvaluation.createdAt))
    .all();

  // Aggregate stats across latest evaluations
  const stats = db
    .select({
      totalEvaluations: sql<number>`COUNT(*)`,
      avgExactPct: sql<number | null>`AVG(${sotEvaluation.sourceExactPct})`,
      avgLenientPct: sql<number | null>`AVG(${sotEvaluation.sourceLenientPct})`,
      totalScoredFields: sql<number>`SUM(${sotEvaluation.scoredFields})`,
      totalExact: sql<number>`SUM(${sotEvaluation.sourceExactCount})`,
      totalLenient: sql<number>`SUM(${sotEvaluation.sourceLenientCount})`,
    })
    .from(sotEvaluation)
    .where(eq(sotEvaluation.workspaceId, workspaceId))
    .get();

  // List entities that have SOT data available
  const availableEntities = listAvailableSotEntities();

  return NextResponse.json({
    evaluations,
    stats: {
      totalEvaluations: stats?.totalEvaluations || 0,
      avgExactPct: stats?.avgExactPct != null
        ? Math.round(stats.avgExactPct * 10) / 10
        : null,
      avgLenientPct: stats?.avgLenientPct != null
        ? Math.round(stats.avgLenientPct * 10) / 10
        : null,
      totalScoredFields: stats?.totalScoredFields || 0,
      totalExact: stats?.totalExact || 0,
      totalLenient: stats?.totalLenient || 0,
    },
    availableEntities,
  });
});

// POST — Trigger SOT evaluation for entity(ies)
export const POST = withAuth(async (req, ctx, { workspaceId }) => {
  const body = await req.json();
  const { entityIds } = body as { entityIds?: string[] };

  // Determine which entities to evaluate
  let targetEntities: { id: string; name: string }[];
  if (entityIds?.length) {
    targetEntities = db
      .select({ id: entity.id, name: entity.name })
      .from(entity)
      .where(
        and(
          eq(entity.workspaceId, workspaceId),
          eq(entity.side, "target"),
        )
      )
      .all()
      .filter((e) => entityIds.includes(e.id));
  } else {
    // Only entities that have at least one generated mapping (is_latest=1)
    // Evaluating entities with no mappings produces meaningless results
    const { fieldMapping, field } = await import("@/lib/db/schema");
    const { inArray } = await import("drizzle-orm");
    const mappedEntityIds = db
      .selectDistinct({ entityId: field.entityId })
      .from(fieldMapping)
      .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
      .where(eq(fieldMapping.isLatest, true))
      .all()
      .map((r) => r.entityId);

    if (mappedEntityIds.length === 0) {
      return NextResponse.json({ message: "No entities with generated mappings found", results: [] });
    }

    targetEntities = db
      .select({ id: entity.id, name: entity.name })
      .from(entity)
      .where(
        and(
          eq(entity.workspaceId, workspaceId),
          eq(entity.side, "target"),
          inArray(entity.id, mappedEntityIds),
        )
      )
      .all();
  }

  const results: Array<{
    entityId: string;
    entityName: string;
    evaluationId?: string;
    status: "completed" | "skipped" | "failed";
    sourceExactPct?: number;
    sourceLenientPct?: number;
    error?: string;
  }> = [];

  for (const te of targetEntities) {
    try {
      const evalResult = evaluateEntityMappings(workspaceId, te.id);

      if (!evalResult) {
        results.push({
          entityId: te.id,
          entityName: te.name,
          status: "skipped",
          error: "No SOT data available",
        });
        continue;
      }

      // Persist to DB
      const evalId = crypto.randomUUID();
      db.insert(sotEvaluation)
        .values({
          id: evalId,
          workspaceId,
          entityId: te.id,
          generationId: evalResult.generationId,
          totalFields: evalResult.totalFields,
          scoredFields: evalResult.scoredFields,
          sourceExactCount: evalResult.sourceExactCount,
          sourceLenientCount: evalResult.sourceLenientCount,
          sourceExactPct: evalResult.sourceExactPct,
          sourceLenientPct: evalResult.sourceLenientPct,
          fieldResults: evalResult.fieldResults,
        })
        .run();

      results.push({
        entityId: te.id,
        entityName: te.name,
        evaluationId: evalId,
        status: "completed",
        sourceExactPct: evalResult.sourceExactPct,
        sourceLenientPct: evalResult.sourceLenientPct,
      });
    } catch (err) {
      results.push({
        entityId: te.id,
        entityName: te.name,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const completed = results.filter((r) => r.status === "completed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({
    message: `Evaluated ${completed} entities (${skipped} skipped, ${failed} failed)`,
    results,
  });
}, { requiredRole: "editor" });
