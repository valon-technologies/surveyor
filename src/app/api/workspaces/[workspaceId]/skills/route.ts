import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skill, skillContext } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createSkillSchema } from "@/lib/validators/skill";
import { withAuth } from "@/lib/auth/api-auth";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const skills = db
    .select()
    .from(skill)
    .where(eq(skill.workspaceId, workspaceId))
    .orderBy(skill.sortOrder)
    .all();

  // Add context counts
  const withCounts = skills.map((s) => {
    const count = db
      .select({ count: sql<number>`count(*)` })
      .from(skillContext)
      .where(eq(skillContext.skillId, s.id))
      .get();
    return { ...s, contextCount: count?.count ?? 0 };
  });

  return NextResponse.json(withCounts);
});

export const POST = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const body = await req.json();
  const parsed = createSkillSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = db
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
    .all();

  return NextResponse.json({ ...created, contextCount: 0 }, { status: 201 });
}, { requiredRole: "editor" });
