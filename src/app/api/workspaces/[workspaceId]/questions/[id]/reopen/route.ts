import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const POST = withAuth(async (req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;

  const q = (await db
    .select({ id: question.id, status: question.status })
    .from(question)
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
)[0];

  if (!q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  if (q.status === "open") {
    return NextResponse.json({ error: "Question is already open" }, { status: 400 });
  }

  const [updated] = await db
    .update(question)
    .set({
      status: "open",
      resolvedBy: null,
      resolvedByName: null,
      resolvedAt: null,
      // Backward compat
      answer: null,
      answeredBy: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(question.id, id))
    .returning()
    ;

  return NextResponse.json(updated);
}, { requiredRole: "editor" });
