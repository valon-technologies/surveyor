import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { userWorkspace } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { WorkspaceRole } from "@/lib/constants";

// PATCH — change member role/team (owner only)
export const PATCH = withAuth(
  async (req, ctx, { workspaceId }) => {
    const params = await ctx.params;
    const targetUserId = params.userId;
    const body = await req.json();
    const { role, team } = body;

    if (role !== undefined && (!role || !["owner", "editor", "viewer"].includes(role))) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (team !== undefined && team !== null && !["SM", "VT"].includes(team)) {
      return NextResponse.json({ error: "Invalid team" }, { status: 400 });
    }

    const membership = (await db
      .select()
      .from(userWorkspace)
      .where(
        and(
          eq(userWorkspace.userId, targetUserId),
          eq(userWorkspace.workspaceId, workspaceId)
        )
      )
      )[0];

    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (role !== undefined) updates.role = role;
    if (team !== undefined) updates.team = team;

    await db.update(userWorkspace)
      .set(updates)
      .where(eq(userWorkspace.id, membership.id))
      ;

    return NextResponse.json({ ...membership, ...updates });
  },
  { requiredRole: "owner" }
);

// DELETE — remove member (owner only)
export const DELETE = withAuth(
  async (_req, ctx, { userId, workspaceId }) => {
    const params = await ctx.params;
    const targetUserId = params.userId;

    if (targetUserId === userId) {
      return NextResponse.json(
        { error: "Cannot remove yourself" },
        { status: 400 }
      );
    }

    const membership = (await db
      .select()
      .from(userWorkspace)
      .where(
        and(
          eq(userWorkspace.userId, targetUserId),
          eq(userWorkspace.workspaceId, workspaceId)
        )
      )
      )[0];

    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (membership.role === "owner") {
      return NextResponse.json(
        { error: "Cannot remove an owner" },
        { status: 403 }
      );
    }

    await db.delete(userWorkspace)
      .where(eq(userWorkspace.id, membership.id))
      ;

    return NextResponse.json({ success: true });
  },
  { requiredRole: "owner" }
);
