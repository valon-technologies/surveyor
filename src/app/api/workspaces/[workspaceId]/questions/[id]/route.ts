import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateQuestionSchema } from "@/lib/validators/question";

export const PATCH = withAuth(async (req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = updateQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = await db
    .update(question)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
    .returning()
    ;

  if (!updated) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });
