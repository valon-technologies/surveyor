import { NextRequest, NextResponse } from "next/server";
import { auth } from "./index";
import { db } from "@/lib/db";
import { userWorkspace } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { WorkspaceRole } from "@/lib/constants";

type RouteContext = { params: Promise<Record<string, string>> };

interface AuthContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

type AuthHandler = (
  req: NextRequest,
  ctx: RouteContext,
  auth: AuthContext
) => Promise<NextResponse>;

interface WithAuthOptions {
  requiredRole?: WorkspaceRole;
}

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

export function withAuth(handler: AuthHandler, options?: WithAuthOptions) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await ctx.params;
    const workspaceId = params.workspaceId;
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    // Check workspace membership
    const membership = db
      .select()
      .from(userWorkspace)
      .where(
        and(
          eq(userWorkspace.userId, session.user.id),
          eq(userWorkspace.workspaceId, workspaceId)
        )
      )
      .get();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const role = membership.role as WorkspaceRole;

    // Check role requirement
    if (options?.requiredRole) {
      if (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[options.requiredRole]) {
        return NextResponse.json(
          { error: `Requires ${options.requiredRole} role` },
          { status: 403 }
        );
      }
    }

    return handler(req, ctx, { userId: session.user.id, workspaceId, role });
  };
}
