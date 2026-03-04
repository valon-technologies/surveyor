import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { pullFromLinear } from "@/lib/linear/linear-sync";

export const POST = withAuth(async (_req, _ctx, { workspaceId }) => {
  try {
    const result = await pullFromLinear(workspaceId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, { requiredRole: "editor" });
