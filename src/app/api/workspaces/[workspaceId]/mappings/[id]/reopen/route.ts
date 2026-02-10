import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/lib/activity/log-activity";

export const POST = withAuth(async (_req, ctx, { userId, workspaceId }) => {
  const params = await ctx.params;
  const { id } = params;

  const existing = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId))))[0];

  if (!existing) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  if (existing.status !== "fully_closed") {
    return NextResponse.json({ error: "Not closed" }, { status: 400 });
  }

  const targetField = (await db.select().from(field).where(eq(field.id, existing.targetFieldId)))[0];

  // Copy-on-write: mark old as not latest
  await db.update(fieldMapping)
    .set({ isLatest: false, updatedAt: new Date().toISOString() })
    .where(eq(fieldMapping.id, id));

  const [newVersion] = await db
    .insert(fieldMapping)
    .values({
      ...existing,
      id: crypto.randomUUID(),
      status: "pending",
      version: existing.version + 1,
      parentId: existing.id,
      isLatest: true,
      changeSummary: `status: fully_closed → pending (case re-opened)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning();

  await logActivity({
    workspaceId,
    fieldMappingId: newVersion.id,
    entityId: targetField?.entityId || null,
    actorId: userId,
    actorName: existing.editedBy || "Unknown",
    action: "case_reopened",
    detail: { from: "fully_closed", to: "pending" },
  });

  return NextResponse.json(newVersion);
}, { requiredRole: "editor" });
