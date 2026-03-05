import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { skillRefresh } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { applyApprovedProposal } from "@/lib/generation/auto-apply";
import type { SkillRefreshProposal } from "@/lib/generation/auto-apply";

/**
 * POST /api/workspaces/:workspaceId/skill-refreshes/:id/apply
 * Apply an approved skill refresh proposal.
 */
export const POST = withAuth(async (_req, ctx, { workspaceId, userId }) => {
  const params = await ctx.params;
  const id = params.id as string;

  const refresh = (await db
    .select()
    .from(skillRefresh)
    .where(
      and(eq(skillRefresh.id, id), eq(skillRefresh.workspaceId, workspaceId)),
    )
    )[0];

  if (!refresh) {
    return NextResponse.json(
      { error: "Skill refresh not found" },
      { status: 404 },
    );
  }

  if (refresh.status !== "approved") {
    return NextResponse.json(
      { error: `Cannot apply a refresh with status "${refresh.status}". Must be "approved" first.` },
      { status: 400 },
    );
  }

  if (!refresh.proposal) {
    return NextResponse.json(
      { error: "No proposal to apply" },
      { status: 400 },
    );
  }

  const proposal = refresh.proposal as SkillRefreshProposal;

  const result = await applyApprovedProposal(
    workspaceId,
    refresh.skillId,
    proposal,
    refresh.id,
    userId,
  );

  return NextResponse.json({
    id: refresh.id,
    status: "approved",
    changesApplied: result.changesApplied,
  });
}, { requiredRole: "editor" });
