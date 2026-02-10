import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skillContext, context } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addSkillContextSchema } from "@/lib/validators/skill";
import { withAuth } from "@/lib/auth/api-auth";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  const scs = db
    .select()
    .from(skillContext)
    .where(eq(skillContext.skillId, id))
    .orderBy(skillContext.sortOrder)
    .all();

  const withDetail = scs.map((sc) => {
    const ctxRow = db.select().from(context).where(eq(context.id, sc.contextId)).get();
    return { ...sc, context: ctxRow };
  });

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

  const [created] = db
    .insert(skillContext)
    .values({
      skillId: id,
      contextId: input.contextId,
      role: input.role,
      sortOrder: input.sortOrder,
      notes: input.notes,
    })
    .returning()
    .all();

  // Return with context detail
  const ctxRow = db.select().from(context).where(eq(context.id, input.contextId)).get();

  return NextResponse.json({ ...created, context: ctxRow }, { status: 201 });
}, { requiredRole: "editor" });
