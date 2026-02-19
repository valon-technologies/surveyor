import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { getSignalQueueForWorkspace } from "@/lib/generation/skill-signals";

/**
 * GET /api/workspaces/:workspaceId/skill-signals
 * Returns the signal queue grouped by entity with aggregate scores.
 */
export const GET = withAuth(async (_req, _ctx, { workspaceId }) => {
  const queue = getSignalQueueForWorkspace(workspaceId);
  return NextResponse.json(queue);
});
