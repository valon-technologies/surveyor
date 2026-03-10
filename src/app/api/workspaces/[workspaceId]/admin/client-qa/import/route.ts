import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, user } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveQuestion } from "@/lib/questions/resolve-question";
import * as XLSX from "xlsx";

/**
 * POST: import client answers from completed XLSX.
 * Expects multipart/form-data with a single file field.
 *
 * For each row with a non-empty Answer:
 * - Looks up question by question_id
 * - Verifies it's open + approved
 * - Resolves it using the shared helper (creates learning, cascade, etc.)
 */
export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Parse XLSX
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({ error: "No worksheet found" }, { status: 400 });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

    // Look up importing user's name
    const [u] = await db.select({ name: user.name }).from(user)
      .where(eq(user.id, userId));
    const importerName = u?.name || "Admin";

    let resolved = 0;
    let skipped = 0;
    const unmatched: string[] = [];
    const errors: string[] = [];

    for (const row of rows) {
      const questionId = row.question_id?.trim();
      const answer = row.Answer?.trim();

      if (!questionId || !answer) continue;

      // Look up question
      const [q] = await db.select().from(question)
        .where(and(eq(question.id, questionId), eq(question.workspaceId, workspaceId)));

      if (!q) {
        unmatched.push(questionId);
        continue;
      }

      if (q.status !== "open") {
        skipped++;
        continue;
      }

      try {
        // Build answer with optional confidence/notes
        const confidence = row.Confidence?.trim();
        const notes = row.Notes?.trim();
        let fullAnswer = answer;
        if (confidence) fullAnswer += ` [Confidence: ${confidence}]`;
        if (notes) fullAnswer += ` [Notes: ${notes}]`;

        await resolveQuestion({
          questionId,
          workspaceId,
          answerText: fullAnswer,
          resolvedByUserId: userId,
          resolvedByName: importerName,
          source: "client",
        });
        resolved++;
      } catch (err) {
        errors.push(`${questionId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      resolved,
      skipped,
      unmatched,
      errors,
      total: rows.length,
    });
  },
  { requiredRole: "owner" }
);
