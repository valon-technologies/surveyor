import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, entity, field } from "@/lib/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";

/**
 * GET: list open SDT questions for client Q&A curation.
 * Params: status=draft|approved|all (default: draft)
 */
export const GET = withAuth(
  async (req, ctx, { workspaceId }) => {
    const searchParams = req.nextUrl.searchParams;
    const statusFilter = searchParams.get("status") || "draft";

    const curationStatuses = statusFilter === "all"
      ? ["draft", "approved"]
      : [statusFilter];

    const rows = await db
      .select({
        question: question,
        entityName: entity.name,
        fieldName: field.name,
        fieldDataType: field.dataType,
        fieldDescription: field.description,
      })
      .from(question)
      .leftJoin(entity, eq(question.entityId, entity.id))
      .leftJoin(field, eq(question.fieldId, field.id))
      .where(
        and(
          eq(question.workspaceId, workspaceId),
          eq(question.status, "open"),
          isNull(question.chatSessionId), // Exclude chat-based questions
          inArray(question.curationStatus, curationStatuses),
        )
      )
      .orderBy(entity.name, field.name, question.createdAt);

    // Group by entity for the UI
    const grouped = new Map<string, {
      entityId: string;
      entityName: string;
      questions: typeof rows;
    }>();

    for (const r of rows) {
      const eid = r.question.entityId || "unknown";
      const ename = r.entityName || "Unknown entity";
      if (!grouped.has(eid)) {
        grouped.set(eid, { entityId: eid, entityName: ename, questions: [] });
      }
      grouped.get(eid)!.questions.push(r);
    }

    return NextResponse.json({
      total: rows.length,
      groups: Array.from(grouped.values()),
    });
  },
  { requiredRole: "owner" }
);
