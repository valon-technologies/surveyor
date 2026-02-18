import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { commentThread, comment } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { updateThreadSchema } from "@/lib/validators/thread";
import { logActivity } from "@/lib/activity/log-activity";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const { threadId } = params;

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
});

export const PATCH = withAuth(async (req, ctx, { userId, workspaceId }) => {
  const params = await ctx.params;
  const { threadId } = params;
  const body = await req.json();
  const parsed = updateThreadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Get existing thread before update
  const existingThread = db
    .select()
    .from(commentThread)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId)))
    .get();

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

  // Log thread_resolved activity
  if (parsed.data.status === "resolved" && existingThread?.status !== "resolved") {
    logActivity({
      workspaceId,
      fieldMappingId: updated.fieldMappingId || null,
      entityId: updated.entityId || null,
      actorId: userId,
      actorName: parsed.data.resolvedBy || "Unknown",
      action: "thread_resolved",
      detail: { threadId, subject: updated.subject },
    });
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (_req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const { threadId } = params;

  db.delete(commentThread)
    .where(and(eq(commentThread.id, threadId), eq(commentThread.workspaceId, workspaceId)))
    .run();

  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
