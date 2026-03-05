import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { workspaceInvite } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET — list pending invites for this workspace
export const GET = withAuth(async (_req, _ctx, { workspaceId }) => {
  const invites = await db
    .select()
    .from(workspaceInvite)
    .where(
      and(
        eq(workspaceInvite.workspaceId, workspaceId),
        eq(workspaceInvite.status, "pending")
      )
    )
    ;

  return NextResponse.json(invites);
});

// POST — create an invite (owner only)
export const POST = withAuth(
  async (req, _ctx, { userId, workspaceId }) => {
    const { email, role = "editor" } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Check for existing pending invite
    const existing = (await db
      .select()
      .from(workspaceInvite)
      .where(
        and(
          eq(workspaceInvite.workspaceId, workspaceId),
          eq(workspaceInvite.email, email),
          eq(workspaceInvite.status, "pending")
        )
      )
      )[0];

    if (existing) {
      return NextResponse.json(
        { error: "An invite for this email is already pending" },
        { status: 409 }
      );
    }

    // Set expiry to 7 days from now
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const [invite] = await db
      .insert(workspaceInvite)
      .values({
        workspaceId,
        email,
        role,
        invitedBy: userId,
        expiresAt,
      })
      .returning()
      ;

    return NextResponse.json(invite, { status: 201 });
  },
  { requiredRole: "owner" }
);
