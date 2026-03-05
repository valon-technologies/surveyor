import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, learning, fieldMapping, field, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { rebuildEntityKnowledge } from "@/lib/generation/entity-knowledge";

export const PATCH = withAuth(
  async (req, ctx, { workspaceId }) => {
    const params = await ctx.params;
    const id = params.id;
    const body = (await req.json()) as {
      feedbackHelpful?: boolean;
      feedbackWhyNot?: string;
      feedbackBetterQuestion?: string;
    };

    const existing = (await db
      .select({ id: question.id, fieldMappingId: question.fieldMappingId, entityId: question.entityId })
      .from(question)
      .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
)[0];

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if ("feedbackHelpful" in body) updates.feedbackHelpful = body.feedbackHelpful ? 1 : 0;
    if ("feedbackWhyNot" in body) updates.feedbackWhyNot = body.feedbackWhyNot ?? null;
    if ("feedbackBetterQuestion" in body) updates.feedbackBetterQuestion = body.feedbackBetterQuestion ?? null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await db.update(question)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(question.id, id))
      ;

    const betterQ = body.feedbackBetterQuestion?.trim();
    if (body.feedbackHelpful === false && betterQ) {
      let entityId = existing.entityId;
      if (!entityId && existing.fieldMappingId) {
        const fmInfo = (await db
          .select({ entityId: entity.id })
          .from(fieldMapping)
          .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
          .innerJoin(entity, eq(field.entityId, entity.id))
          .where(eq(fieldMapping.id, existing.fieldMappingId))
          )[0];
        entityId = fmInfo?.entityId ?? null;
      }

      if (entityId) {
        await db.insert(learning).values({
          id: crypto.randomUUID(),
          workspaceId,
          entityId,
          scope: "entity",
          source: "review",
          content: `Open question (improved): ${betterQ}`,
        });

        rebuildEntityKnowledge(workspaceId, entityId);
      }
    }

    return NextResponse.json({ success: true });
  },
  { requiredRole: "editor" }
);
