import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { user, workspace, userWorkspace, workspaceInvite } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, email, password } = body;

  if (!email || !password || !name) {
    return NextResponse.json(
      { error: "Name, email, and password are required" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Check existing user
  const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [newUser] = await db
    .insert(user)
    .values({ name, email, passwordHash })
    .returning();

  // Check for pending invites — auto-accept them instead of creating an empty workspace
  const pendingInvites = await db
    .select()
    .from(workspaceInvite)
    .where(
      and(
        eq(workspaceInvite.email, email),
        eq(workspaceInvite.status, "pending"),
      ),
    );

  if (pendingInvites.length > 0) {
    // Auto-accept all pending invites
    for (const invite of pendingInvites) {
      await db.insert(userWorkspace)
        .values({ userId: newUser.id, workspaceId: invite.workspaceId, role: invite.role });

      await db.update(workspaceInvite)
        .set({
          status: "accepted",
          acceptedBy: newUser.id,
          acceptedAt: new Date().toISOString(),
        })
        .where(eq(workspaceInvite.id, invite.id));
    }
  } else if (email.endsWith("@valon.com")) {
    // Auto-join the first workspace as editor for Valon employees
    const [firstWs] = await db.select().from(workspace).limit(1);
    if (firstWs) {
      await db.insert(userWorkspace)
        .values({ userId: newUser.id, workspaceId: firstWs.id, role: "editor" });
    }
  } else {
    // No invites, non-Valon — create a personal workspace
    const [ws] = await db
      .insert(workspace)
      .values({
        name: `${name}'s Workspace`,
        description: "Personal mapping workspace",
        settings: { defaultProvider: "claude" },
      })
      .returning();

    await db.insert(userWorkspace)
      .values({ userId: newUser.id, workspaceId: ws.id, role: "owner" });
  }

  return NextResponse.json(
    { id: newUser.id, name: newUser.name, email: newUser.email },
    { status: 201 }
  );
}
