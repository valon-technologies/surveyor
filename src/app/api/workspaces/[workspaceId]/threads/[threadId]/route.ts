import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commentThread, comment } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { updateThreadSchema } from "@/lib/validators/thread";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; threadId: string }> }
) {
  const { workspaceId, threadId } = await params;

  const thread = db
    .select()
    .from(commentThread)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId)))
    .get();

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const comments = db
    .select()
    .from(comment)
    .where(eq(comment.threadId, threadId))
    .orderBy(asc(comment.createdAt))
    .all();

  return NextResponse.json({ ...thread, comments });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; threadId: string }> }
) {
  const { workspaceId, threadId } = await params;
  const body = await req.json();
  const parsed = updateThreadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  };

  // If resolving, set resolvedAt
  if (parsed.data.status === "resolved") {
    updateData.resolvedAt = new Date().toISOString();
    if (parsed.data.resolvedBy) {
      updateData.resolvedBy = parsed.data.resolvedBy;
    }
  }

  const [updated] = db
    .update(commentThread)
    .set(updateData)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId)))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; threadId: string }> }
) {
  const { workspaceId, threadId } = await params;

  db.delete(commentThread)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId)))
    .run();

  return NextResponse.json({ success: true });
}
