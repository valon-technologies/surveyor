import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logActivity } from "@/lib/activity/log-activity";
import { batchExcludeSchema } from "@/lib/validators/review";

export const POST = withAuth(
  async (req, _ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const parsed = batchExcludeSchema.parse(body);
    const { mappingIds, reason } = parsed;

    // Verify all IDs belong to this workspace
    const mappings = db
      .select({ id: fieldMapping.id })
      .from(fieldMapping)
      .where(
        and(
          inArray(fieldMapping.id, mappingIds),
          eq(fieldMapping.workspaceId, workspaceId)
        )
      )
      .all();

    const validIds = new Set(mappings.map((m) => m.id));
    const invalidIds = mappingIds.filter((id) => !validIds.has(id));

    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: `Mappings not found: ${invalidIds.join(", ")}` },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    for (const id of mappingIds) {
      db.update(fieldMapping)
        .set({
          status: "excluded",
          excludeReason: reason || null,
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
        action: "status_change",
        detail: { reviewAction: "excluded", reason: reason || undefined, batch: true },
      });
    }

    return NextResponse.json({ excluded: mappingIds.length });
  },
  { requiredRole: "editor" }
);
