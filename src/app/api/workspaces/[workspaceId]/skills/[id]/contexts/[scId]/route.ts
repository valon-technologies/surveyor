import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skillContext } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateSkillContextSchema } from "@/lib/validators/skill";
import { withAuth } from "@/lib/auth/api-auth";

export const PATCH = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { scId } = params;
  const body = await req.json();
  const parsed = updateSkillContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = await db
    .update(skillContext)
    .set(parsed.data)
    .where(eq(skillContext.id, scId))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { scId } = params;

  await db.delete(skillContext).where(eq(skillContext.id, scId));

  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
