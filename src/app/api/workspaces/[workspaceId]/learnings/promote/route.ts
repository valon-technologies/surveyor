import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { z } from "zod/v4";
import { promoteToWorkspaceRule } from "@/lib/generation/mapping-learning";

const promoteSchema = z.object({
  content: z.string().min(1).max(500),
});

/**
 * POST /api/workspaces/[workspaceId]/learnings/promote
 * Promote a correction to a workspace-wide rule.
 */
export const POST = withAuth(
  async (req, _ctx, { workspaceId }) => {
    const body = await req.json();
    const parsed = promoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    try {
      const { id } = promoteToWorkspaceRule(
        workspaceId,
        parsed.data.content,
        "review",
      );
      return NextResponse.json({ id, promoted: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  },
  { requiredRole: "editor" }
);
