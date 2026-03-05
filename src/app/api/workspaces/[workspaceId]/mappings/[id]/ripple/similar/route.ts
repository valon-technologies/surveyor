import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { findSimilarMappings } from "@/lib/ripple/similarity-engine";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const id = params.id;

  try {
    const result = await findSimilarMappings(workspaceId, id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to find similar mappings" },
      { status: 400 }
    );
  }
});
