import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { applyRippleProposals } from "@/lib/ripple/ripple-runner";
import type { RippleProposal } from "@/types/ripple";

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const params = await ctx.params;
    const id = params.id;
    const body = await req.json();

    const { proposals } = body as { proposals: RippleProposal[] };

    if (!Array.isArray(proposals) || proposals.length === 0) {
      return NextResponse.json(
        { error: "proposals must be a non-empty array" },
        { status: 400 }
      );
    }

    try {
      const result = applyRippleProposals(workspaceId, userId, proposals, id);
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to apply proposals" },
        { status: 500 }
      );
    }
  },
  { requiredRole: "editor" }
);
