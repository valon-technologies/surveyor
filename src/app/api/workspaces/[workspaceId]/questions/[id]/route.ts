import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { question } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateQuestionSchema } from "@/lib/validators/question";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const body = await req.json();
  const parsed = updateQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = db
    .update(question)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
