import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/lib/activity/log-activity";

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const params = await ctx.params;
    const id = params.id;

    const mapping = db
      .select()
      .from(fieldMapping)
      .where(
        and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId))
      )
      .get();

    if (!mapping) {
      return NextResponse.json(
        { error: "Mapping not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    db.update(fieldMapping)
      .set({
        status: "accepted",
        updatedAt: now,
      })
      .where(eq(fieldMapping.id, id))
      .run();

    logActivity({
      workspaceId,
      fieldMappingId: id,
      entityId: null,
      actorId: userId,
      actorName: "user",
      action: "case_closed",
      detail: { reviewAction: "accepted" },
    });

    const updated = db
      .select()
      .from(fieldMapping)
      .where(eq(fieldMapping.id, id))
      .get();

    return NextResponse.json(updated);
  },
  { requiredRole: "editor" }
);
