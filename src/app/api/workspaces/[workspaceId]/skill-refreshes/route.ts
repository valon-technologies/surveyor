import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { skillRefresh, skill } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { matchSkills } from "@/lib/generation/context-assembler";
import { runIncrementalForge } from "@/lib/generation/incremental-forge";

/**
 * GET /api/workspaces/:workspaceId/skill-refreshes
 * List skill refreshes with optional status filter.
 */
export const GET = withAuth(async (req, _ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const statusFilter = searchParams.get("status");

  const conditions = [eq(skillRefresh.workspaceId, workspaceId)];
  if (statusFilter) {
    conditions.push(eq(skillRefresh.status, statusFilter));
  }

  const refreshes = db
    .select({
      id: skillRefresh.id,
      skillId: skillRefresh.skillId,
      status: skillRefresh.status,
      triggerScore: skillRefresh.triggerScore,
      signalCount: skillRefresh.signalCount,
      proposal: skillRefresh.proposal,
      reviewedBy: skillRefresh.reviewedBy,
      createdAt: skillRefresh.createdAt,
      updatedAt: skillRefresh.updatedAt,
      skillName: skill.name,
    })
    .from(skillRefresh)
    .leftJoin(skill, eq(skillRefresh.skillId, skill.id))
    .where(and(...conditions))
    .orderBy(desc(skillRefresh.createdAt))
    .limit(50)
    .all();

  return NextResponse.json(refreshes);
});

/**
 * POST /api/workspaces/:workspaceId/skill-refreshes
 * Trigger an incremental forge for a skill/entity pair.
 * Body: { skillId: string, entityId: string }
 */
export const POST = withAuth(async (req, _ctx, { workspaceId, userId }) => {
  const body = await req.json();
  const { skillId, entityId } = body as {
    skillId?: string;
    entityId?: string;
  };

  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 },
    );
  }

  // Resolve skillId if not provided — find matching skill for entity
  let resolvedSkillId = skillId;
  if (!resolvedSkillId) {
    const matched = matchSkills(workspaceId, entityId);
    if (matched.length > 0) {
      resolvedSkillId = matched[0].id;
    }
  }

  if (!resolvedSkillId) {
    return NextResponse.json(
      { error: "No matching skill found for this entity" },
      { status: 404 },
    );
  }

  try {
    const result = await runIncrementalForge({
      workspaceId,
      skillId: resolvedSkillId,
      entityId,
      userId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}, { requiredRole: "editor" });
