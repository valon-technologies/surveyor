import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { user, workspace, userWorkspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
    .returning()
    ;

  // Create a default workspace for the new user
  const [ws] = await db
    .insert(workspace)
    .values({
      name: `${name}'s Workspace`,
      description: "Personal mapping workspace",
      settings: { defaultProvider: "claude" },
    })
    .returning()
    ;

  await db.insert(userWorkspace)
    .values({ userId: newUser.id, workspaceId: ws.id, role: "owner" })
    ;

  return NextResponse.json(
    { id: newUser.id, name: newUser.name, email: newUser.email },
    { status: 201 }
  );
}
