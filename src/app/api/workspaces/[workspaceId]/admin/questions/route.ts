import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, entity, field } from "@/lib/db/schema";
import { eq, and, like } from "drizzle-orm";

// GET: list questions by curation status for admin review
export const GET = withAuth(
  async (req, ctx, { workspaceId }) => {
    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get("status") || "draft";

    const rows = await db
      .select({
        question: question,
        entityName: entity.name,
        fieldName: field.name,
      })
      .from(question)
      .leftJoin(entity, eq(question.entityId, entity.id))
      .leftJoin(field, eq(question.fieldId, field.id))
      .where(
        and(
          eq(question.workspaceId, workspaceId),
          eq(question.curationStatus, status),
        )
      )
      .orderBy(question.createdAt)
      ;

    // For each draft question, find similar approved questions for dedup
    const result = await Promise.all(rows.map(async (r) => {
      // Simple keyword dedup: find approved questions with overlapping words
      const words = r.question.question
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 5);

      let similarQuestions: { id: string; question: string }[] = [];
      if (words.length > 0) {
        const approved = await db
          .select({ id: question.id, question: question.question })
          .from(question)
          .where(
            and(
              eq(question.workspaceId, workspaceId),
              eq(question.curationStatus, "approved"),
            )
          )
          ;

        similarQuestions = approved
          .filter((aq) => {
            const aqLower = aq.question.toLowerCase();
            const matches = words.filter((w) => aqLower.includes(w)).length;
            return matches >= 2; // at least 2 keyword overlaps
          })
          .slice(0, 3);
      }

      return {
        ...r.question,
        entityName: r.entityName,
        fieldName: r.fieldName,
        similarQuestions,
      };
    }));

    return NextResponse.json(result);
  },
  { requiredRole: "owner" }
);

// PATCH: curate a question (approve, reject, mark as duplicate)
export const PATCH = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const { questionId, action, duplicateOf, editedQuestion } = body as {
      questionId: string;
      action: "approve" | "reject" | "duplicate";
      duplicateOf?: string;
      editedQuestion?: string;
    };

    if (!questionId || !["approve", "reject", "duplicate"].includes(action)) {
      return NextResponse.json(
        { error: "questionId and action (approve|reject|duplicate) required" },
        { status: 400 }
      );
    }

    const existing = (await db
      .select()
      .from(question)
      .where(
        and(eq(question.id, questionId), eq(question.workspaceId, workspaceId))
      )
      )[0];

    if (!existing) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === "approve") {
      const updates: Record<string, unknown> = {
        curationStatus: "approved",
        curatedBy: userId,
        curatedAt: now,
        updatedAt: now,
      };
      if (editedQuestion) {
        updates.question = editedQuestion;
      }
      await db.update(question)
        .set(updates)
        .where(eq(question.id, questionId))
        ;
    } else if (action === "reject") {
      await db.update(question)
        .set({
          curationStatus: "rejected",
          curatedBy: userId,
          curatedAt: now,
          updatedAt: now,
        })
        .where(eq(question.id, questionId))
        ;
    } else if (action === "duplicate") {
      await db.update(question)
        .set({
          curationStatus: "duplicate",
          curatedBy: userId,
          curatedAt: now,
          duplicateOf: duplicateOf || null,
          updatedAt: now,
        })
        .where(eq(question.id, questionId))
        ;
    }

    return NextResponse.json({ success: true, action });
  },
  { requiredRole: "owner" }
);
