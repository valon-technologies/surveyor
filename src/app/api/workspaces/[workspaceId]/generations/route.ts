import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createGenerationSchema } from "@/lib/validators/generation";
import { startGeneration, executeGeneration } from "@/lib/generation/runner";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const entityId = searchParams.get("entityId");

  const conditions = [eq(generation.workspaceId, workspaceId)];
  if (entityId) conditions.push(eq(generation.entityId, entityId));

  const generations = await db
    .select()
    .from(generation)
    .where(and(...conditions))
    .orderBy(generation.createdAt);

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

    try {
      const { startResult, prepared } = await startGeneration({
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
