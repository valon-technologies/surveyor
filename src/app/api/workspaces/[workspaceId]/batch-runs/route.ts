import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { batchRun } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createBatchRunSchema } from "@/lib/validators/batch-run";
import { createBatchRun, executeBatchRun } from "@/lib/generation/batch-runner";
import {
  createBulkChatRun,
  executeBulkChatRun,
} from "@/lib/generation/bulk-chat-runner";
import { MAPPING_STATUSES } from "@/lib/constants";
import { checkDailyTokenBudget } from "@/lib/generation/cost-guardrails";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const runs = db
    .select()
    .from(batchRun)
    .where(eq(batchRun.workspaceId, workspaceId))
    .orderBy(batchRun.createdAt)
    .all();

  return NextResponse.json(runs);
});

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const parsed = createBatchRunSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const mode = parsed.data.mode || "single-shot";

    // Guard: check daily token budget before spending on LLM calls
    const budgetCheck = checkDailyTokenBudget(workspaceId);
    if (!budgetCheck.allowed) {
      return NextResponse.json(
        { error: budgetCheck.message },
        { status: 429 },
      );
    }

    // Guard: prevent concurrent batch runs (avoids duplicate LLM spend)
    const activeBatch = db
      .select({ id: batchRun.id })
      .from(batchRun)
      .where(
        and(
          eq(batchRun.workspaceId, workspaceId),
          inArray(batchRun.status, ["pending", "running"]),
        ),
      )
      .get();

    if (activeBatch) {
      return NextResponse.json(
        { error: "A batch run is already in progress. Please wait for it to complete." },
        { status: 409 },
      );
    }

    // Resolve includeStatuses: prefer explicit array, fall back from legacy boolean
    const includeStatuses = parsed.data.includeStatuses
      ?? (parsed.data.skipAlreadyMapped === false ? [...MAPPING_STATUSES] : undefined);

    try {
      if (mode === "chat") {
        // RAG chat mode: per-field sessions with tool use
        const { batchRunId, entities, totalFields } = createBulkChatRun({
          workspaceId,
          userId,
          entityIds: parsed.data.entityIds,
          preferredProvider: parsed.data.preferredProvider,
          model: parsed.data.model,
          includeStatuses,
        });

        // Fire-and-forget
        executeBulkChatRun(batchRunId, entities, {
          workspaceId,
          userId,
          entityIds: parsed.data.entityIds,
          preferredProvider: parsed.data.preferredProvider,
          model: parsed.data.model,
          includeStatuses,
        }).catch((err) => {
          console.error("Bulk chat run error:", batchRunId, err);
        });

        return NextResponse.json({
          batchRunId,
          status: "pending",
          mode: "chat",
          totalEntities: entities.length,
          totalFields,
        });
      } else {
        // Legacy single-shot mode
        const { batchRunId, entities, totalFields } = createBatchRun({
          workspaceId,
          userId,
          preferredProvider: parsed.data.preferredProvider,
          model: parsed.data.model,
          includeStatuses,
          outputFormat: parsed.data.outputFormat,
          entityIds: parsed.data.entityIds,
        });

        // Fire-and-forget
        executeBatchRun(batchRunId, entities, {
          workspaceId,
          userId,
          preferredProvider: parsed.data.preferredProvider,
          model: parsed.data.model,
          includeStatuses,
          outputFormat: parsed.data.outputFormat,
          entityIds: parsed.data.entityIds,
        }).catch((err) => {
          console.error("Batch run execution error:", batchRunId, err);
        });

        return NextResponse.json({
          batchRunId,
          status: "pending",
          mode: "single-shot",
          totalEntities: entities.length,
          totalFields,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Batch run failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  },
  { requiredRole: "editor" }
);
