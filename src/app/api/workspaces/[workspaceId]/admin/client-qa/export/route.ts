import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, entity, field } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";

/**
 * POST: curate + export selected questions as XLSX for client.
 * Body: { questionIds: string[], edits?: Record<questionId, string> }
 *
 * Side effects:
 * - Applies any inline edits to question text
 * - Sets curationStatus = "approved" on all selected questions
 * - Returns XLSX file as download
 */
export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const { questionIds, edits } = body as {
      questionIds: string[];
      edits?: Record<string, string>;
    };

    if (!questionIds?.length) {
      return NextResponse.json({ error: "questionIds required" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Apply edits and approve all selected questions
    for (const qid of questionIds) {
      const updates: Record<string, unknown> = {
        curationStatus: "approved",
        curatedBy: userId,
        curatedAt: now,
        updatedAt: now,
      };
      if (edits?.[qid]) {
        updates.question = edits[qid];
      }
      await db.update(question)
        .set(updates)
        .where(and(eq(question.id, qid), eq(question.workspaceId, workspaceId)));
    }

    // Load approved questions with entity/field context
    const rows = await db
      .select({
        questionId: question.id,
        questionText: question.question,
        entityName: entity.name,
        fieldName: field.name,
        fieldDataType: field.dataType,
        fieldDescription: field.description,
      })
      .from(question)
      .leftJoin(entity, eq(question.entityId, entity.id))
      .leftJoin(field, eq(question.fieldId, field.id))
      .where(inArray(question.id, questionIds))
      .orderBy(entity.name, field.name);

    // Build XLSX rows
    const xlsxRows = rows.map((r) => ({
      question_id: r.questionId,
      Entity: r.entityName || "",
      Field: r.fieldName || "",
      "Data Type": r.fieldDataType || "",
      Question: r.questionText,
      "Field Description": r.fieldDescription || "",
      Answer: "",
      Confidence: "",
      Notes: "",
    }));

    const ws = XLSX.utils.json_to_sheet(xlsxRows);
    ws["!cols"] = [
      { wch: 36 },  // question_id
      { wch: 30 },  // Entity
      { wch: 30 },  // Field
      { wch: 12 },  // Data Type
      { wch: 60 },  // Question
      { wch: 50 },  // Field Description
      { wch: 50 },  // Answer
      { wch: 12 },  // Confidence
      { wch: 40 },  // Notes
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Client Questions");

    // Instructions sheet
    const instructions = [
      { Instructions: "CLIENT QUESTION SHEET" },
      { Instructions: "" },
      { Instructions: "Columns A-F are pre-populated. DO NOT EDIT these columns." },
      { Instructions: "" },
      { Instructions: "For each question, fill in:" },
      { Instructions: "  Answer (column G): Your response to the question" },
      { Instructions: "  Confidence (column H): High, Medium, or Low (optional)" },
      { Instructions: "  Notes (column I): Any additional context (optional)" },
      { Instructions: "" },
      { Instructions: `Exported: ${now}` },
      { Instructions: `Total questions: ${xlsxRows.length}` },
    ];
    const instrWs = XLSX.utils.json_to_sheet(instructions);
    instrWs["!cols"] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

    // Generate buffer
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="client-questions-${now.slice(0, 10)}.xlsx"`,
      },
    });
  },
  { requiredRole: "owner" }
);
