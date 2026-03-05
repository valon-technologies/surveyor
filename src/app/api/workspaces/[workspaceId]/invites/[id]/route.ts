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

    const invite = (await db
      .select()
      .from(workspaceInvite)
      .where(
        and(
          eq(workspaceInvite.id, inviteId),
          eq(workspaceInvite.workspaceId, workspaceId)
        )
      )
      )[0];

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    await db.update(workspaceInvite)
      .set({ status: "revoked" })
      .where(eq(workspaceInvite.id, inviteId))
      ;

    return NextResponse.json({ success: true });
  },
  { requiredRole: "owner" }
);
