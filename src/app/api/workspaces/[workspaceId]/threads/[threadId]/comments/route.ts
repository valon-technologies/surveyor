import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { comment, commentThread } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createCommentSchema } from "@/lib/validators/thread";
import { logActivity } from "@/lib/activity/log-activity";

export const POST = withAuth(async (req, ctx, { userId, workspaceId }) => {
  const params = await ctx.params;
  const { threadId } = params;
  const body = await req.json();
  const parsed = createCommentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Verify thread exists
  const thread = (await db
    .select()
    .from(commentThread)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId))))[0];

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const [created] = await db
    .insert(comment)
    .values({
      threadId,
      authorName: parsed.data.authorName,
      body: parsed.data.body,
      bodyFormat: parsed.data.bodyFormat || "markdown",
    })
    .returning();

  // Increment comment count
  await db.update(commentThread)
    .set({
      commentCount: thread.commentCount + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(commentThread.id, threadId));

  await logActivity({
    workspaceId,
    fieldMappingId: thread.fieldMappingId || null,
    entityId: thread.entityId || null,
    actorId: userId,
    actorName: parsed.data.authorName,
    action: "comment_added",
    detail: { threadId, subject: thread.subject },
  });

  return NextResponse.json(created, { status: 201 });
}, { requiredRole: "editor" });
