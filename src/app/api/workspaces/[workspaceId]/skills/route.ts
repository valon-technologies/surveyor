import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skill, skillContext } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createSkillSchema } from "@/lib/validators/skill";
import { withAuth } from "@/lib/auth/api-auth";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const skills = await db
    .select()
    .from(skill)
    .where(eq(skill.workspaceId, workspaceId))
    .orderBy(skill.sortOrder)
    ;

  // Add context counts
  const withCounts = await Promise.all(skills.map(async (s) => {
    const count = (await db
      .select({ count: sql<number>`count(*)` })
      .from(skillContext)
      .where(eq(skillContext.skillId, s.id))
      )[0];
    return { ...s, contextCount: count?.count ?? 0 };
  }));

  return NextResponse.json(withCounts);
});

export const POST = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const body = await req.json();
  const parsed = createSkillSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = await db
    .insert(skill)
    .values({
      workspaceId,
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      applicability: input.applicability,
      tags: input.tags,
    })
    .returning()
    ;

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json({ ...created, contextCount: 0 }, { status: 201 });
}, { requiredRole: "editor" });
