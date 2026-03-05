import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userWorkspace, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      role: userWorkspace.role,
    })
    .from(userWorkspace)
    .innerJoin(workspace, eq(userWorkspace.workspaceId, workspace.id))
    .where(eq(userWorkspace.userId, session.user.id))
    ;

  return NextResponse.json(memberships);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const [ws] = await db
    .insert(workspace)
    .values({
      name: name.trim(),
      description: "Created workspace",
      settings: { defaultProvider: "claude" },
    })
    .returning()
    ;

  await db.insert(userWorkspace)
    .values({ userId: session.user.id, workspaceId: ws.id, role: "owner" })
    ;

  return NextResponse.json(ws, { status: 201 });
}
