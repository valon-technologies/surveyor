import { db } from "@/lib/db";
import { question } from "@/lib/db/schema";

interface ContextGap {
  description: string;
  questionId: string;
}

/**
 * Strip code-fenced blocks so we only match CONTEXT GAP markers in prose,
 * not inside JSON notes fields of mapping-update blocks.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/**
 * Extracts "CONTEXT GAP" markers from LLM output and persists each
 * as an open question record for the SM team to resolve.
 *
 * Handles LLM format variations:
 *   CONTEXT GAP: ...
 *   **CONTEXT GAP IDENTIFIED**: ...
 *   **CONTEXT GAP DETECTED**: ...
 */
export function extractAndPersistContextGaps(
  fullContent: string,
  context: {
    workspaceId: string;
    entityId: string;
    fieldId?: string;
    fieldMappingId?: string | null;
    chatSessionId: string;
  }
): ContextGap[] {
  const gaps: ContextGap[] = [];

  // Strip code blocks so we don't match inside JSON notes
  const prose = stripCodeBlocks(fullContent);

  // Match variants: CONTEXT GAP:, **CONTEXT GAP IDENTIFIED**:, CONTEXT GAP DETECTED:, etc.
  const regex = /\*{0,2}CONTEXT GAP[^:]*\*{0,2}:\s*(.+?)(?=\n\n|\n[A-Z#*]|$)/g;

  for (const match of prose.matchAll(regex)) {
    const description = match[1].trim();
    if (!description) continue;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(question)
      .values({
        id,
        workspaceId: context.workspaceId,
        entityId: context.entityId,
        fieldId: context.fieldId || null,
        question: description,
        status: "open",
        askedBy: "llm",
        priority: "high",
        targetForTeam: "SM",
        fieldMappingId: context.fieldMappingId || null,
        chatSessionId: context.chatSessionId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    gaps.push({ description, questionId: id });
  }

  return gaps;
}
