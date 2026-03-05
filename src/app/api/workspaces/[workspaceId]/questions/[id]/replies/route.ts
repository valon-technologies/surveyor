import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, questionReply, user } from "@/lib/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { createQuestionReplySchema } from "@/lib/validators/question";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;

  // Verify question exists in workspace
  const q = (await db
    .select({ id: question.id })
    .from(question)
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
)[0];

  if (!q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const replies = await db
    .select()
    .from(questionReply)
    .where(eq(questionReply.questionId, id))
    .orderBy(asc(questionReply.createdAt))
    ;

  return NextResponse.json(replies);
});

export const POST = withAuth(async (req, ctx, { userId, workspaceId }) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = createQuestionReplySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Verify question exists in workspace
  const q = (await db
    .select({ id: question.id, replyCount: question.replyCount })
    .from(question)
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
)[0];

  if (!q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  // Look up author name
  const u = (await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    )[0];
  const authorName = u?.name || "User";

  const [created] = await db
    .insert(questionReply)
    .values({
      questionId: id,
      authorId: userId,
      authorName,
      authorRole: "user",
      body: parsed.data.body,
    })
    .returning()
    ;

  // Atomic increment — avoids stale read-modify-write under concurrency
  await db.update(question)
    .set({
      replyCount: sql`${question.replyCount} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(question.id, id))
    ;

  return NextResponse.json(created, { status: 201 });
}, { requiredRole: "editor" });
