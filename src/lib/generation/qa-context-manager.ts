import { db } from "@/lib/db";
import { context, skillContext, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { estimateTokens } from "@/lib/llm/token-counter";
import { matchSkills } from "./context-assembler";
import { invalidateWorkspaceContextCache } from "./context-cache";
import { emitSignal } from "./skill-signals";

interface UpsertQaContextParams {
  workspaceId: string;
  entityId: string;
  entityName: string;
  fieldName: string | null;
  questionText: string;
  answerText: string;
  resolvedByName: string;
}

/**
 * Find or create a QA Knowledge context document for the entity,
 * append the resolved Q&A, and link it to matching skills.
 */
export function upsertQaContext(params: UpsertQaContextParams): {
  contextId: string;
  created: boolean;
} {
  const {
    workspaceId,
    entityId,
    entityName,
    fieldName,
    questionText,
    answerText,
    resolvedByName,
  } = params;

  const date = new Date().toISOString().split("T")[0];
  const fieldLabel = fieldName || "Entity-level";
  const qaBlock = [
    `### ${fieldLabel}: ${questionText}`,
    `**Answer**: ${answerText}`,
    `*Resolved by ${resolvedByName} on ${date}*`,
    "---",
    "",
  ].join("\n");

  // Look for existing QA Knowledge context for this entity
  const existing = db
    .select()
    .from(context)
    .where(
      and(
        eq(context.workspaceId, workspaceId),
        eq(context.category, "adhoc"),
        eq(context.subcategory, "qa_knowledge"),
        eq(context.entityId, entityId)
      )
    )
    .get();

  let contextId: string;
  let created = false;

  if (existing) {
    // Append to existing content
    const newContent = existing.content
      ? existing.content + "\n" + qaBlock
      : qaBlock;

    db.update(context)
      .set({
        content: newContent,
        tokenCount: estimateTokens(newContent),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(context.id, existing.id))
      .run();

    contextId = existing.id;
  } else {
    // Create new QA Knowledge context
    const header = `# QA Knowledge: ${entityName}\n\nResolved questions and answers for ${entityName}.\n\n`;
    const fullContent = header + qaBlock;

    const [inserted] = db
      .insert(context)
      .values({
        workspaceId,
        name: `QA Knowledge > ${entityName}`,
        category: "adhoc",
        subcategory: "qa_knowledge",
        entityId,
        content: fullContent,
        contentFormat: "markdown",
        tokenCount: estimateTokens(fullContent),
        tags: ["qa", entityName.toLowerCase()],
        isActive: true,
      })
      .returning()
      .all();

    contextId = inserted.id;
    created = true;
  }

  // Link to matching skills as supplementary (if not already linked)
  linkToMatchingSkills(workspaceId, contextId, entityName);

  // Invalidate context cache so next generation picks up the new content
  invalidateWorkspaceContextCache(workspaceId);

  // Emit question_resolved signal for skill refresh tracking
  try {
    emitSignal({
      workspaceId,
      entityId,
      signalType: "question_resolved",
      summary: `Q: ${questionText.slice(0, 100)} → A: ${answerText.slice(0, 100)}`,
      sourceId: contextId,
      sourceType: "qa_context",
    });
  } catch {
    // Non-critical
  }

  return { contextId, created };
}

function linkToMatchingSkills(
  workspaceId: string,
  contextId: string,
  entityName: string
): void {
  const matched = matchSkills(workspaceId, entityName);

  for (const s of matched) {
    // Check if already linked
    const exists = db
      .select({ id: skillContext.id })
      .from(skillContext)
      .where(
        and(
          eq(skillContext.skillId, s.id),
          eq(skillContext.contextId, contextId)
        )
      )
      .get();

    if (!exists) {
      db.insert(skillContext)
        .values({
          skillId: s.id,
          contextId,
          role: "supplementary",
          sortOrder: 999,
          notes: "Auto-linked from QA knowledge",
        })
        .run();
    }
  }
}
