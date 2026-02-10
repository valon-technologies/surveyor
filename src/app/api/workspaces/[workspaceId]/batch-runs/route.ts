import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { batchRun } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createBatchRunSchema } from "@/lib/validators/batch-run";
import { createBatchRun, executeBatchRun } from "@/lib/generation/batch-runner";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const runs = await db
    .select()
    .from(batchRun)
    .where(eq(batchRun.workspaceId, workspaceId))
    .orderBy(batchRun.createdAt);

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

    try {
      const { batchRunId, entities, totalFields } = await createBatchRun({
        workspaceId,
        userId,
        preferredProvider: parsed.data.preferredProvider,
        model: parsed.data.model,
        skipAlreadyMapped: parsed.data.skipAlreadyMapped,
      });

      // Fire-and-forget: execute in background
      executeBatchRun(batchRunId, entities, {
        workspaceId,
        userId,
        preferredProvider: parsed.data.preferredProvider,
        model: parsed.data.model,
        skipAlreadyMapped: parsed.data.skipAlreadyMapped,
      }).catch(() => {
        // Error handling is done inside executeBatchRun
      });

      return NextResponse.json({
        batchRunId,
        status: "pending",
        totalEntities: entities.length,
        totalFields,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Batch run failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  },
  { requiredRole: "editor" }
);
