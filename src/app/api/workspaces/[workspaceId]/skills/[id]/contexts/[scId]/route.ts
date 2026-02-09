import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { skillContext } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateSkillContextSchema } from "@/lib/validators/skill";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string; scId: string }> }
) {
  const { scId } = await params;
  const body = await req.json();
  const parsed = updateSkillContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = db
    .update(skillContext)
    .set(parsed.data)
    .where(eq(skillContext.id, scId))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string; scId: string }> }
) {
  const { scId } = await params;

  db.delete(skillContext).where(eq(skillContext.id, scId)).run();

  return NextResponse.json({ success: true });
}
