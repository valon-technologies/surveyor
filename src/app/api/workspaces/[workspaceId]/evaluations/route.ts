import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { evaluation, question } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { evaluateQuestion } from "@/lib/evaluation/eval-runner";

// GET — List evaluations with aggregate stats
export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const evaluations = db
    .select()
    .from(evaluation)
    .where(eq(evaluation.workspaceId, workspaceId))
    .orderBy(sql`${evaluation.createdAt} DESC`)
    .limit(limit)
    .offset(offset)
    .all();

  // Aggregate stats
  const stats = db
    .select({
      totalEvaluations: sql<number>`COUNT(*)`,
      avgJudgeScore: sql<number | null>`AVG(${evaluation.judgeScore})`,
      avgTokenOverlap: sql<number | null>`AVG(${evaluation.tokenOverlap})`,
    })
    .from(evaluation)
    .where(
      and(
        eq(evaluation.workspaceId, workspaceId),
        eq(evaluation.status, "completed")
      )
    )
    .get();

  return NextResponse.json({
    evaluations,
    stats: {
      totalEvaluations: stats?.totalEvaluations || 0,
      avgJudgeScore: stats?.avgJudgeScore
        ? Math.round(stats.avgJudgeScore * 10) / 10
        : null,
      avgTokenOverlap: stats?.avgTokenOverlap
        ? Math.round(stats.avgTokenOverlap)
        : null,
    },
  });
});

// POST — Trigger evaluations for resolved questions
export const POST = withAuth(async (req, ctx, { workspaceId, userId }) => {
  const body = await req.json();
  const { questionIds, runJudge = false } = body as {
    questionIds?: string[];
    runJudge?: boolean;
  };

  // Determine which questions to evaluate
  let targetQuestionIds: string[];
  if (questionIds?.length) {
    targetQuestionIds = questionIds;
  } else {
    // All resolved questions in workspace
    const resolved = db
      .select({ id: question.id })
      .from(question)
      .where(
        and(
          eq(question.workspaceId, workspaceId),
          eq(question.status, "resolved")
        )
      )
      .all();
    targetQuestionIds = resolved.map((q) => q.id);
  }

  if (targetQuestionIds.length === 0) {
    return NextResponse.json({
      message: "No resolved questions to evaluate",
      results: [],
    });
  }

  // Run evaluations sequentially (each one calls the LLM)
  const results: Array<{
    questionId: string;
    evaluationId?: string;
    status: "completed" | "failed";
    error?: string;
  }> = [];

  for (const qId of targetQuestionIds) {
    try {
      const result = await evaluateQuestion({
        workspaceId,
        questionId: qId,
        userId,
        runJudge,
      });
      results.push({
        questionId: qId,
        evaluationId: result.evaluationId,
        status: "completed",
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";

      // Record failed evaluation
      db.insert(evaluation)
        .values({
          workspaceId,
          questionId: qId,
          humanAnswer: "",
          status: "failed",
          error: errorMsg,
        })
        .run();

      results.push({
        questionId: qId,
        status: "failed",
        error: errorMsg,
      });
    }
  }

  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({
    message: `Evaluated ${completed} questions (${failed} failed)`,
    results,
  });
}, { requiredRole: "editor" });
