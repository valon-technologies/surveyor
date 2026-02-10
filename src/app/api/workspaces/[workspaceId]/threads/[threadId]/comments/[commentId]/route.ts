import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { comment, commentThread } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateCommentSchema } from "@/lib/validators/thread";

export const PATCH = withAuth(async (req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const { threadId, commentId } = params;
  const body = await req.json();
  const parsed = updateCommentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = await db
    .update(comment)
    .set({
      body: parsed.data.body,
      editedAt: new Date().toISOString(),
    })
    .where(and(eq(comment.id, commentId), eq(comment.threadId, threadId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (_req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const { threadId, commentId } = params;

  // Delete comment
  await db.delete(comment)
    .where(and(eq(comment.id, commentId), eq(comment.threadId, threadId)));

  // Decrement comment count
  const thread = (await db
    .select()
    .from(commentThread)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId))))[0];

  if (thread) {
    await db.update(commentThread)
      .set({
        commentCount: Math.max(0, thread.commentCount - 1),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(commentThread.id, threadId));
  }

  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
