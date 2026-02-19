import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/lib/activity/log-activity";
import { createMappingVersion } from "@/lib/db/copy-on-write";

export const POST = withAuth(async (_req, ctx, { userId, workspaceId }) => {
  const params = await ctx.params;
  const { id } = params;

  const existing = db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  if (existing.status === "accepted") {
    return NextResponse.json({ error: "Already closed" }, { status: 400 });
  }

  const targetField = db.select().from(field).where(eq(field.id, existing.targetFieldId)).get();

  const newVersion = createMappingVersion(existing.id, {
    ...existing,
    id: crypto.randomUUID(),
    status: "accepted",
    version: existing.version + 1,
    parentId: existing.id,
    changeSummary: `status: ${existing.status} → accepted (case closed)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  logActivity({
    workspaceId,
    fieldMappingId: newVersion.id,
    entityId: targetField?.entityId || null,
    actorId: userId,
    actorName: existing.editedBy || "Unknown",
    action: "case_closed",
    detail: { from: existing.status, to: "accepted" },
  });

  return NextResponse.json(newVersion);
}, { requiredRole: "editor" });
