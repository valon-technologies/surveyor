import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { skillRefresh, skill } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/workspaces/:workspaceId/skill-refreshes/:id
 * Get a single skill refresh with full details.
 */
export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const id = params.id as string;

  const refresh = db
    .select({
      id: skillRefresh.id,
      workspaceId: skillRefresh.workspaceId,
      skillId: skillRefresh.skillId,
      status: skillRefresh.status,
      triggerScore: skillRefresh.triggerScore,
      signalCount: skillRefresh.signalCount,
      proposal: skillRefresh.proposal,
      appliedChanges: skillRefresh.appliedChanges,
      reviewedBy: skillRefresh.reviewedBy,
      chatSessionId: skillRefresh.chatSessionId,
      createdAt: skillRefresh.createdAt,
      updatedAt: skillRefresh.updatedAt,
      skillName: skill.name,
    })
    .from(skillRefresh)
    .leftJoin(skill, eq(skillRefresh.skillId, skill.id))
    .where(
      and(eq(skillRefresh.id, id), eq(skillRefresh.workspaceId, workspaceId)),
    )
    .get();

  if (!refresh) {
    return NextResponse.json(
      { error: "Skill refresh not found" },
      { status: 404 },
    );
  }

  return NextResponse.json(refresh);
});

/**
 * PUT /api/workspaces/:workspaceId/skill-refreshes/:id
 * Update a skill refresh status (approve/reject).
 * Body: { status: "approved" | "rejected" }
 */
export const PUT = withAuth(async (req, ctx, { workspaceId, userId }) => {
  const params = await ctx.params;
  const id = params.id as string;
  const body = await req.json();
  const { status } = body as { status?: string };

  if (!status || !["approved", "rejected"].includes(status)) {
    return NextResponse.json(
      { error: "status must be 'approved' or 'rejected'" },
      { status: 400 },
    );
  }

  const refresh = db
    .select()
    .from(skillRefresh)
    .where(
      and(eq(skillRefresh.id, id), eq(skillRefresh.workspaceId, workspaceId)),
    )
    .get();

  if (!refresh) {
    return NextResponse.json(
      { error: "Skill refresh not found" },
      { status: 404 },
    );
  }

  if (refresh.status !== "proposed") {
    return NextResponse.json(
      { error: `Cannot ${status} a refresh with status "${refresh.status}"` },
      { status: 400 },
    );
  }

  db.update(skillRefresh)
    .set({
      status,
      reviewedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(skillRefresh.id, id))
    .run();

  return NextResponse.json({ id, status });
}, { requiredRole: "editor" });
