import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skill, skillContext, context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateSkillSchema } from "@/lib/validators/skill";
import { withAuth } from "@/lib/auth/api-auth";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  const s = db
    .select()
    .from(skill)
    .where(and(eq(skill.id, id), eq(skill.workspaceId, workspaceId)))
    .get();

  if (!s) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch contexts with detail
  const scs = db
    .select()
    .from(skillContext)
    .where(eq(skillContext.skillId, id))
    .orderBy(skillContext.sortOrder)
    .all();

  const contexts = scs.map((sc) => {
    const ctxRow = db.select().from(context).where(eq(context.id, sc.contextId)).get();
    return { ...sc, context: ctxRow };
  });

  return NextResponse.json({ ...s, contexts });
});

export const PATCH = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;
  const body = await req.json();
  const parsed = updateSkillSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = db
    .update(skill)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(skill.id, id), eq(skill.workspaceId, workspaceId)))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json(updated);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  db.delete(skill)
    .where(and(eq(skill.id, id), eq(skill.workspaceId, workspaceId)))
    .run();

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
