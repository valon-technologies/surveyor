import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { question } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createQuestionSchema } from "@/lib/validators/question";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get("status");
  const entityId = searchParams.get("entityId");

  const conditions = [eq(question.workspaceId, workspaceId)];
  if (status) conditions.push(eq(question.status, status));
  if (entityId) conditions.push(eq(question.entityId, entityId));

  const questions = db
    .select()
    .from(question)
    .where(and(...conditions))
    .orderBy(question.createdAt)
    .all();

  return NextResponse.json(questions);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const body = await req.json();
  const parsed = createQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = db
    .insert(question)
    .values({
      workspaceId,
      entityId: input.entityId,
      fieldId: input.fieldId,
      question: input.question,
      askedBy: input.askedBy || "user",
    })
    .returning()
    .all();

  return NextResponse.json(created, { status: 201 });
}
