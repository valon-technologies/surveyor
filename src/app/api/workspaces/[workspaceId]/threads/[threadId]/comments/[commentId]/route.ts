import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comment, commentThread } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateCommentSchema } from "@/lib/validators/thread";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; threadId: string; commentId: string }> }
) {
  const { threadId, commentId } = await params;
  const body = await req.json();
  const parsed = updateCommentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = db
    .update(comment)
    .set({
      body: parsed.data.body,
      editedAt: new Date().toISOString(),
    })
    .where(and(eq(comment.id, commentId), eq(comment.threadId, threadId)))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; threadId: string; commentId: string }> }
) {
  const { workspaceId, threadId, commentId } = await params;

  // Delete comment
  db.delete(comment)
    .where(and(eq(comment.id, commentId), eq(comment.threadId, threadId)))
    .run();

  // Decrement comment count
  const thread = db
    .select()
    .from(commentThread)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId)))
    .get();

  if (thread) {
    db.update(commentThread)
      .set({
        commentCount: Math.max(0, thread.commentCount - 1),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(commentThread.id, threadId))
      .run();
  }

  return NextResponse.json({ success: true });
}
