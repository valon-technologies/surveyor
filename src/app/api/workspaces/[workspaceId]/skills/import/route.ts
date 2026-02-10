// This route is no longer used. The skills/import endpoint was for the deprecated
// context-as-skill import flow. Use /contexts for context import instead.
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";

export const POST = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  return NextResponse.json(
    { error: "Deprecated. Use /api/workspaces/{id}/contexts for context import." },
    { status: 410 }
  );
}, { requiredRole: "editor" });
