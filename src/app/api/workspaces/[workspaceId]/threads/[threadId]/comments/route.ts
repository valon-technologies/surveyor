import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comment, commentThread } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createCommentSchema } from "@/lib/validators/thread";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; threadId: string }> }
) {
  const { workspaceId, threadId } = await params;
  const body = await req.json();
  const parsed = createCommentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Verify thread exists
  const thread = db
    .select()
    .from(commentThread)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId)))
    .get();

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const [created] = db
    .insert(comment)
    .values({
      threadId,
      authorName: parsed.data.authorName,
      body: parsed.data.body,
      bodyFormat: parsed.data.bodyFormat || "markdown",
    })
    .returning()
    .all();

  // Increment comment count
  db.update(commentThread)
    .set({
      commentCount: thread.commentCount + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(commentThread.id, threadId))
    .run();

  return NextResponse.json(created, { status: 201 });
}
