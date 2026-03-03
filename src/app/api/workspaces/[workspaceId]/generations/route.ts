import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createGenerationSchema } from "@/lib/validators/generation";
import { startGeneration, executeGeneration } from "@/lib/generation/runner";
import { checkDailyTokenBudget } from "@/lib/generation/cost-guardrails";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
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
});

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const parsed = createGenerationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    // Guard: check daily token budget
    const budgetCheck = checkDailyTokenBudget(workspaceId);
    if (!budgetCheck.allowed) {
      return NextResponse.json(
        { error: budgetCheck.message },
        { status: 429 },
      );
    }

    try {
      const { startResult, prepared } = startGeneration({
        workspaceId,
        userId,
        entityId: parsed.data.entityId,
        fieldIds: parsed.data.fieldIds,
        generationType: parsed.data.generationType,
        preferredProvider: parsed.data.preferredProvider,
        model: parsed.data.model,
      });

      // Fire-and-forget: don't await
      executeGeneration(prepared).catch(() => {
        // Error handling is done inside executeGeneration (updates DB record)
      });

      return NextResponse.json(startResult);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Generation failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  },
  { requiredRole: "editor" }
);
