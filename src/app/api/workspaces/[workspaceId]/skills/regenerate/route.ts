import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { regenerateAllSkills } from "@/lib/generation/skill-generator";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";

export const POST = withAuth(async (req, _ctx, { workspaceId }) => {
  try {
    const result = regenerateAllSkills(workspaceId);

    invalidateWorkspaceContextCache(workspaceId);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}, { requiredRole: "editor" });
