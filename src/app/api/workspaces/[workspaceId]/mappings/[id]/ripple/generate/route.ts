import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { generateRippleProposals } from "@/lib/ripple/ripple-runner";

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const params = await ctx.params;
    const id = params.id;
    const body = await req.json();

    const { targetMappingIds, userInstruction } = body;

    if (!Array.isArray(targetMappingIds) || targetMappingIds.length === 0) {
      return NextResponse.json(
        { error: "targetMappingIds must be a non-empty array" },
        { status: 400 }
      );
    }

    try {
      const result = await generateRippleProposals({
        workspaceId,
        userId,
        exemplarMappingId: id,
        targetMappingIds,
        userInstruction: userInstruction || undefined,
      });

      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to generate proposals" },
        { status: 500 }
      );
    }
  },
  { requiredRole: "editor" }
);
