import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/lib/activity/log-activity";
import { excludeMappingSchema } from "@/lib/validators/review";

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const params = await ctx.params;
    const id = params.id;

    // Parse body (backward compat for empty body)
    let reason = "";
    try {
      const body = await req.json();
      const parsed = excludeMappingSchema.parse(body);
      reason = parsed.reason;
    } catch {
      // Empty body or invalid JSON — proceed with no reason
    }

    const mapping = (await db
      .select()
      .from(fieldMapping)
      .where(
        and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId))
      )
      )[0];

    if (!mapping) {
      return NextResponse.json(
        { error: "Mapping not found" },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    await db.update(fieldMapping)
      .set({
        status: "excluded",
        excludeReason: reason || null,
        updatedAt: now,
      })
      .where(eq(fieldMapping.id, id))
      ;

    logActivity({
      workspaceId,
      fieldMappingId: id,
      entityId: null,
      actorId: userId,
      actorName: "user",
      action: "status_change",
      detail: { reviewAction: "excluded", reason: reason || undefined },
    });

    const updated = (await db
      .select()
      .from(fieldMapping)
      .where(eq(fieldMapping.id, id))
      )[0];

    return NextResponse.json(updated);
  },
  { requiredRole: "editor" }
);
