import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceInvite, userWorkspace } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const invite = (await db
    .select()
    .from(workspaceInvite)
    .where(eq(workspaceInvite.id, id))
    )[0];

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.status !== "pending") {
    return NextResponse.json(
      { error: `Invite is ${invite.status}` },
      { status: 400 }
    );
  }

  if (invite.email !== session.user.email) {
    return NextResponse.json(
      { error: "This invite is for a different email" },
      { status: 403 }
    );
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
  }

  // Check if user is already a member
  const existing = (await db
    .select()
    .from(userWorkspace)
    .where(
      and(
        eq(userWorkspace.userId, session.user.id),
        eq(userWorkspace.workspaceId, invite.workspaceId)
      )
    )
    )[0];

  if (existing) {
    // Mark invite as accepted but don't create duplicate membership
    await db.update(workspaceInvite)
      .set({
        status: "accepted",
        acceptedBy: session.user.id,
        acceptedAt: new Date().toISOString(),
      })
      .where(eq(workspaceInvite.id, id))
      ;

    return NextResponse.json({ workspaceId: invite.workspaceId, alreadyMember: true });
  }

  // Accept: create membership + update invite
  await db.insert(userWorkspace)
    .values({
      userId: session.user.id,
      workspaceId: invite.workspaceId,
      role: invite.role,
    })
    ;

  await db.update(workspaceInvite)
    .set({
      status: "accepted",
      acceptedBy: session.user.id,
      acceptedAt: new Date().toISOString(),
    })
    .where(eq(workspaceInvite.id, id))
    ;

  return NextResponse.json({ workspaceId: invite.workspaceId });
}
