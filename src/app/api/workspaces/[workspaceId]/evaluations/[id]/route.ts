import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { evaluation, question, entity, field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET — Single evaluation detail
export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;

  const eval_ = (await db
    .select()
    .from(evaluation)
    .where(
      and(eq(evaluation.id, id), eq(evaluation.workspaceId, workspaceId))
    )
    )[0];

  if (!eval_) {
    return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
  }

  // Enrich with question context
  const q = (await db
    .select()
    .from(question)
    .where(eq(question.id, eval_.questionId))
    )[0];

  let entityName: string | null = null;
  let fieldName: string | null = null;

  if (q?.entityId) {
    const e = (await db
      .select({ name: entity.name, displayName: entity.displayName })
      .from(entity)
      .where(eq(entity.id, q.entityId))
      )[0];
    entityName = e?.displayName || e?.name || null;
  }

  if (q?.fieldId) {
    const f = (await db
      .select({ name: field.name })
      .from(field)
      .where(eq(field.id, q.fieldId))
      )[0];
    fieldName = f?.name || null;
  }

  return NextResponse.json({
    ...eval_,
    question: q
      ? {
          id: q.id,
          question: q.question,
          entityName,
          fieldName,
          status: q.status,
        }
      : null,
  });
});
