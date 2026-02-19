import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { evaluation, question, entity, field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET — Single evaluation detail
export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;

  const eval_ = db
    .select()
    .from(evaluation)
    .where(
      and(eq(evaluation.id, id), eq(evaluation.workspaceId, workspaceId))
    )
    .get();

  if (!eval_) {
    return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
  }

  // Enrich with question context
  const q = db
    .select()
    .from(question)
    .where(eq(question.id, eval_.questionId))
    .get();

  let entityName: string | null = null;
  let fieldName: string | null = null;

  if (q?.entityId) {
    const e = db
      .select({ name: entity.name, displayName: entity.displayName })
      .from(entity)
      .where(eq(entity.id, q.entityId))
      .get();
    entityName = e?.displayName || e?.name || null;
  }

  if (q?.fieldId) {
    const f = db
      .select({ name: field.name })
      .from(field)
      .where(eq(field.id, q.fieldId))
      .get();
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
