import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skill, skillContext, context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateSkillSchema } from "@/lib/validators/skill";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

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
    const ctx = db.select().from(context).where(eq(context.id, sc.contextId)).get();
    return { ...sc, context: ctx };
  });

  return NextResponse.json({ ...s, contexts });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
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

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;

  db.delete(skill)
    .where(and(eq(skill.id, id), eq(skill.workspaceId, workspaceId)))
    .run();

  return NextResponse.json({ success: true });
}
