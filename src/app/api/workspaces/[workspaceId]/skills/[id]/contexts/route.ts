import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skillContext, context } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addSkillContextSchema } from "@/lib/validators/skill";
import { withAuth } from "@/lib/auth/api-auth";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  const scs = await db
    .select()
    .from(skillContext)
    .where(eq(skillContext.skillId, id))
    .orderBy(skillContext.sortOrder)
    ;

  const withDetail = await Promise.all(scs.map(async (sc) => {
    const [ctxRow] = await db.select().from(context).where(eq(context.id, sc.contextId)).limit(1);
    return { ...sc, context: ctxRow };
  }));

  return NextResponse.json(withDetail);
});

export const POST = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;
  const body = await req.json();
  const parsed = addSkillContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = await db
    .insert(skillContext)
    .values({
      skillId: id,
      contextId: input.contextId,
      role: input.role,
      sortOrder: input.sortOrder,
      notes: input.notes,
    })
    .returning()
    ;

  // Return with context detail
  const [ctxRow] = await db.select().from(context).where(eq(context.id, input.contextId)).limit(1);

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json({ ...created, context: ctxRow }, { status: 201 });
}, { requiredRole: "editor" });
