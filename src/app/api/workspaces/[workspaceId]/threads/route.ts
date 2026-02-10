import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { commentThread, comment, userWorkspace, fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createThreadSchema } from "@/lib/validators/thread";
import { logActivity } from "@/lib/activity/log-activity";
import { computeStatusOnComment } from "@/lib/status/status-engine";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const entityId = searchParams.get("entityId");
  const fieldMappingId = searchParams.get("fieldMappingId");
  const status = searchParams.get("status");

  const conditions = [eq(commentThread.workspaceId, workspaceId)];
  if (entityId) conditions.push(eq(commentThread.entityId, entityId));
  if (fieldMappingId) conditions.push(eq(commentThread.fieldMappingId, fieldMappingId));
  if (status) conditions.push(eq(commentThread.status, status));

  const threads = await db
    .select()
    .from(commentThread)
    .where(and(...conditions))
    .orderBy(commentThread.createdAt);

  return NextResponse.json(threads);
});

export const POST = withAuth(async (req, ctx, { userId, workspaceId }) => {
  const body = await req.json();
  const parsed = createThreadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { createdBy, body: commentBody, bodyFormat, entityId, fieldMappingId, subject } = parsed.data;

  // Create thread + first comment atomically
  const [thread] = await db
    .insert(commentThread)
    .values({
      workspaceId,
      entityId: entityId || null,
      fieldMappingId: fieldMappingId || null,
      subject: subject || null,
      createdBy,
      commentCount: 1,
    })
    .returning();

  const [firstComment] = await db
    .insert(comment)
    .values({
      threadId: thread.id,
      authorName: createdBy,
      body: commentBody,
      bodyFormat: bodyFormat || "markdown",
    })
    .returning();

  // Log thread_created activity
  await logActivity({
    workspaceId,
    fieldMappingId: fieldMappingId || null,
    entityId: entityId || null,
    actorId: userId,
    actorName: createdBy,
    action: "thread_created",
    detail: { subject: subject || null, threadId: thread.id },
  });

  // Auto-transition mapping status based on commenter's team
  if (fieldMappingId) {
    const membership = (await db
      .select({ team: userWorkspace.team })
      .from(userWorkspace)
      .where(
        and(
          eq(userWorkspace.userId, userId),
          eq(userWorkspace.workspaceId, workspaceId)
        )
      ))[0];

    if (membership?.team) {
      const mapping = (await db
        .select()
        .from(fieldMapping)
        .where(and(eq(fieldMapping.id, fieldMappingId), eq(fieldMapping.isLatest, true))))[0];

      if (mapping) {
        const newStatus = computeStatusOnComment(mapping.status, membership.team as "SM" | "VT");
        if (newStatus !== mapping.status) {
          // Copy-on-write status change
          await db.update(fieldMapping)
            .set({ isLatest: false, updatedAt: new Date().toISOString() })
            .where(eq(fieldMapping.id, mapping.id));

          const [newVersion] = await db
            .insert(fieldMapping)
            .values({
              ...mapping,
              id: crypto.randomUUID(),
              status: newStatus,
              version: mapping.version + 1,
              parentId: mapping.id,
              isLatest: true,
              editedBy: createdBy,
              changeSummary: `status: ${mapping.status} → ${newStatus} (comment by ${membership.team} member)`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .returning();

          await logActivity({
            workspaceId,
            fieldMappingId: newVersion.id,
            entityId: entityId || null,
            actorId: userId,
            actorName: createdBy,
            action: "status_change",
            detail: { from: mapping.status, to: newStatus, trigger: "comment" },
          });
        }
      }
    }
  }

  return NextResponse.json({ ...thread, comments: [firstComment] }, { status: 201 });
}, { requiredRole: "editor" });
