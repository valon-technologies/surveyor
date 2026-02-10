import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createQuestionSchema } from "@/lib/validators/question";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get("status");
  const entityId = searchParams.get("entityId");
  const targetForTeam = searchParams.get("targetForTeam");

  const conditions = [eq(question.workspaceId, workspaceId)];
  if (status) conditions.push(eq(question.status, status));
  if (entityId) conditions.push(eq(question.entityId, entityId));
  if (targetForTeam) conditions.push(eq(question.targetForTeam, targetForTeam));

  const questions = await db
    .select()
    .from(question)
    .where(and(...conditions))
    .orderBy(question.createdAt);

  return NextResponse.json(questions);
});

export const POST = withAuth(async (req, ctx, { workspaceId }) => {
  const body = await req.json();
  const parsed = createQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = await db
    .insert(question)
    .values({
      workspaceId,
      entityId: input.entityId,
      fieldId: input.fieldId,
      question: input.question,
      askedBy: input.askedBy || "user",
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}, { requiredRole: "editor" });
