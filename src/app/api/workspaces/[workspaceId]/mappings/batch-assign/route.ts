import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export const POST = withAuth(
  async (req, _ctx, { workspaceId }) => {
    const { mappingIds, assigneeId } = (await req.json()) as {
      mappingIds: string[];
      assigneeId: string | null;
    };

    if (!mappingIds?.length) {
      return NextResponse.json({ error: "mappingIds required" }, { status: 400 });
    }

    // Verify all IDs belong to this workspace
    const mappings = await db
      .select({ id: fieldMapping.id })
      .from(fieldMapping)
      .where(
        and(
          inArray(fieldMapping.id, mappingIds),
          eq(fieldMapping.workspaceId, workspaceId),
        )
      );

    const validIds = mappings.map((m) => m.id);
    if (validIds.length === 0) {
      return NextResponse.json({ error: "No valid mappings found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    await db
      .update(fieldMapping)
      .set({ assigneeId, updatedAt: now })
      .where(
        and(
          inArray(fieldMapping.id, validIds),
          eq(fieldMapping.workspaceId, workspaceId),
        )
      );

    return NextResponse.json({ assigned: validIds.length, assigneeId });
  },
  { requiredRole: "editor" }
);
