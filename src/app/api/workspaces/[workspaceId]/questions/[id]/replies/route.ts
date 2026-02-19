import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, questionReply, user } from "@/lib/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { createQuestionReplySchema } from "@/lib/validators/question";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;

  // Verify question exists in workspace
  const q = db
    .select({ id: question.id })
    .from(question)
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
    .get();

  if (!q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const replies = db
    .select()
    .from(questionReply)
    .where(eq(questionReply.questionId, id))
    .orderBy(asc(questionReply.createdAt))
    .all();

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
  const q = db
    .select({ id: question.id, replyCount: question.replyCount })
    .from(question)
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
    .get();

  if (!q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  // Look up author name
  const u = db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  const authorName = u?.name || "User";

  const [created] = db
    .insert(questionReply)
    .values({
      questionId: id,
      authorId: userId,
      authorName,
      authorRole: "user",
      body: parsed.data.body,
    })
    .returning()
    .all();

  // Atomic increment — avoids stale read-modify-write under concurrency
  db.update(question)
    .set({
      replyCount: sql`${question.replyCount} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(question.id, id))
    .run();

  return NextResponse.json(created, { status: 201 });
}, { requiredRole: "editor" });
