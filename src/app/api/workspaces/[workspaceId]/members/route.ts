import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { userWorkspace, user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET — list members of this workspace
export const GET = withAuth(async (_req, _ctx, { workspaceId }) => {
  const members = await db
    .select({
      id: userWorkspace.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: userWorkspace.role,
      team: userWorkspace.team,
      joinedAt: userWorkspace.createdAt,
    })
    .from(userWorkspace)
    .innerJoin(user, eq(userWorkspace.userId, user.id))
    .where(eq(userWorkspace.workspaceId, workspaceId));

  return NextResponse.json(members);
});
