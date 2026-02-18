import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { workspaceInvite } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// DELETE — revoke an invite (owner only)
export const DELETE = withAuth(
  async (_req, ctx, { workspaceId }) => {
    const params = await ctx.params;
    const inviteId = params.id;

    const invite = db
      .select()
      .from(workspaceInvite)
      .where(
        and(
          eq(workspaceInvite.id, inviteId),
          eq(workspaceInvite.workspaceId, workspaceId)
        )
      )
      .get();

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    db.update(workspaceInvite)
      .set({ status: "revoked" })
      .where(eq(workspaceInvite.id, inviteId))
      .run();

    return NextResponse.json({ success: true });
  },
  { requiredRole: "owner" }
);
