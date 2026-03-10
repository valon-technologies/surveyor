import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, user } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveQuestionSchema } from "@/lib/validators/question";
import { resolveQuestion } from "@/lib/questions/resolve-question";

export const POST = withAuth(async (req, ctx, { userId, workspaceId }) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = resolveQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Verify question exists in workspace
  const [q] = await db.select().from(question)
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)));

  if (!q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  if (q.status !== "open") {
    return NextResponse.json({ error: "Question is not open" }, { status: 400 });
  }

  // Look up author name
  const [u] = await db.select({ name: user.name }).from(user)
    .where(eq(user.id, userId));
  const authorName = u?.name || "User";

  const answerText = parsed.data.body?.trim() || "";

  const result = await resolveQuestion({
    questionId: id,
    workspaceId,
    answerText,
    resolvedByUserId: userId,
    resolvedByName: authorName,
    source: "review",
  });

  // Return the updated question
  const [updated] = await db.select().from(question).where(eq(question.id, id));

  return NextResponse.json({ ...updated, cascadeCount: result.cascadeCount });
}, { requiredRole: "editor" });
