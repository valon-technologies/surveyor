import { db } from "@/lib/db";
import { context, skillContext, learning, question, field, entity, commentThread, comment, fieldMapping } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { estimateTokens } from "@/lib/llm/token-counter";
import { matchSkills } from "./context-assembler";
import { invalidateWorkspaceContextCache } from "./context-cache";
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";

const CATEGORY = "adhoc";
const SUBCATEGORY = "entity_knowledge";

interface ResolvedQuestion {
  fieldName: string | null;
  question: string;
  answer: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

interface LearningRecord {
  fieldName: string | null;
  content: string;
  source: string;
  createdAt: string;
}

interface ThreadDecision {
  fieldName: string | null;
  subject: string | null;
  comments: string[];
  resolvedAt: string | null;
}

/**
 * Rebuild the Entity Knowledge context document for a given entity.
 *
 * This is the single source of truth for accumulated human knowledge about
 * an entity's mappings. It replaces (not appends to) the context doc each
 * time, keeping it clean and deduplicated.
 *
 * Sources:
 * - Mapping correction learnings (source="review")
 * - Training insights (source="training")
 * - Resolved questions with answers
 *
 * The doc is linked to matching skills as "reference" so it flows through
 * the normal RAG retrieval path.
 */
export async function rebuildEntityKnowledge(
  workspaceId: string,
  entityId: string,
  correlationId?: string,
): Promise<{ contextId: string; created: boolean } | null> {
  // Resolve entity name
  const e = (await db
    .select({ name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(eq(entity.id, entityId))
    )[0];

  if (!e) return null;
  const entityName = e.displayName || e.name;

  // Gather only VALIDATED learning records for this entity
  const learnings = await db
    .select({
      fieldName: learning.fieldName,
      content: learning.content,
      source: learning.source,
      createdAt: learning.createdAt,
    })
    .from(learning)
    .where(and(
      eq(learning.workspaceId, workspaceId),
      eq(learning.entityId, entityId),
      eq(learning.validationStatus, "validated"),
    ))
    .orderBy(desc(learning.createdAt))
    ;

  // Gather all resolved questions for this entity
  const resolvedQuestions = await db
    .select({
      fieldId: question.fieldId,
      questionText: question.question,
      answer: question.answer,
      resolvedByName: question.resolvedByName,
      resolvedAt: question.resolvedAt,
    })
    .from(question)
    .where(
      and(
        eq(question.workspaceId, workspaceId),
        eq(question.entityId, entityId),
        eq(question.status, "resolved"),
      ),
    )
    .orderBy(desc(question.resolvedAt))
    ;

  // Resolve field names for questions
  const fieldNameCache = new Map<string, string>();
  const resolveFieldName = async (fieldId: string | null): Promise<string | null> => {
    if (!fieldId) return null;
    if (fieldNameCache.has(fieldId)) return fieldNameCache.get(fieldId)!;
    const [f] = await db.select({ name: field.name }).from(field).where(eq(field.id, fieldId)).limit(1);
    const name = f?.name || null;
    if (name) fieldNameCache.set(fieldId, name);
    return name;
  };

  const questions: ResolvedQuestion[] = await Promise.all(resolvedQuestions
    .filter((q) => q.answer)
    .map(async (q) => ({
      fieldName: await resolveFieldName(q.fieldId),
      question: q.questionText,
      answer: q.answer!,
      resolvedByName: q.resolvedByName,
      resolvedAt: q.resolvedAt,
    })));

  // Gather resolved comment threads for this entity — human decisions made in discussion
  const resolvedThreads = await db
    .select({
      id: commentThread.id,
      subject: commentThread.subject,
      fieldMappingId: commentThread.fieldMappingId,
      resolvedAt: commentThread.resolvedAt,
    })
    .from(commentThread)
    .where(
      and(
        eq(commentThread.workspaceId, workspaceId),
        eq(commentThread.entityId, entityId),
        eq(commentThread.status, "resolved"),
      ),
    )
    .orderBy(desc(commentThread.resolvedAt))
    ;

  const threadDecisions: ThreadDecision[] = await Promise.all(resolvedThreads.map(async (t) => {
    // Resolve field name from the linked mapping
    let fieldName: string | null = null;
    if (t.fieldMappingId) {
      const [fm] = await db.select({ targetFieldId: fieldMapping.targetFieldId })
        .from(fieldMapping).where(eq(fieldMapping.id, t.fieldMappingId)).limit(1);
      if (fm) fieldName = await resolveFieldName(fm.targetFieldId);
    }

    // Get the last few comments (most recent = likely the decision)
    const threadComments = (await db
      .select({ body: comment.body, authorName: comment.authorName })
      .from(comment)
      .where(eq(comment.threadId, t.id))
      .orderBy(desc(comment.createdAt))
      )
      .slice(0, 3)
      .reverse();

    return {
      fieldName,
      subject: t.subject,
      comments: threadComments.map((c) => `${c.authorName}: ${c.body}`),
      resolvedAt: t.resolvedAt,
    };
  }));

  // Nothing to write — clean up any existing doc
  if (learnings.length === 0 && questions.length === 0 && threadDecisions.length === 0) {
    await deactivateExisting(workspaceId, entityId);
    return null;
  }

  // Render the document
  const content = renderDocument(entityName, learnings, questions, threadDecisions);

  // Upsert the context doc
  const { contextId, created } = await upsertContext(workspaceId, entityId, entityName, content);

  // Emit feedback event for pipeline tracing
  const correctionLearnings = learnings.filter((l) => l.source === "review");
  const trainingLearnings = learnings.filter((l) => l.source === "training");
  const snippets = correctionLearnings.slice(0, 5).map((c) => c.content.slice(0, 120));

  emitFeedbackEvent({
    workspaceId,
    entityId,
    eventType: "entity_knowledge_rebuilt",
    payload: {
      contextId,
      sectionCount: [
        correctionLearnings.length > 0,
        trainingLearnings.length > 0,
        questions.length > 0,
        threadDecisions.length > 0,
      ].filter(Boolean).length,
      totalTokens: estimateTokens(content),
      correctionCount: correctionLearnings.length,
      snippets,
    },
    correlationId,
  });

  // Link to matching skills
  await linkToMatchingSkills(workspaceId, contextId, entityName);

  // Invalidate cache
  invalidateWorkspaceContextCache(workspaceId);

  return { contextId, created };
}

/**
 * Render a clean, structured markdown document from all knowledge sources.
 *
 * Deduplication: for mapping corrections (source="review"), only the most
 * recent correction per field is shown. Training insights and resolved
 * questions are all included (they're curated content).
 */
function renderDocument(
  entityName: string,
  learnings: LearningRecord[],
  questions: ResolvedQuestion[],
  threadDecisions: ThreadDecision[] = [],
): string {
  const parts: string[] = [];
  parts.push(`# Entity Knowledge: ${entityName}\n`);

  // Section 1: Mapping corrections (source="review") — deduplicated by field
  const corrections = learnings.filter((l) => l.source === "review");
  if (corrections.length > 0) {
    parts.push(`## MANDATORY CORRECTIONS — DO NOT OVERRIDE\n`);
    parts.push(`The following corrections are verified against production ground truth. You MUST apply each one exactly. Do NOT substitute your own reasoning. If a correction conflicts with other context, the correction wins.\n`);
    const seen = new Set<string>();
    for (const c of corrections) {
      // Most recent first (already ordered by createdAt DESC), skip dupes
      const key = (c.fieldName || "__entity__").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(`- ${c.content}`);
    }
    parts.push("");
  }

  // Section 2: Training insights (source="training") — deduplicated by field
  const training = learnings.filter((l) => l.source === "training");
  if (training.length > 0) {
    // Separate entity-level vs field-level
    const entityLevel = training.filter((l) => !l.fieldName);
    const fieldLevel = training.filter((l) => l.fieldName);

    if (entityLevel.length > 0) {
      parts.push(`## Entity-Level Patterns\n`);
      for (const t of entityLevel) {
        parts.push(t.content);
        parts.push("");
      }
    }

    if (fieldLevel.length > 0) {
      parts.push(`## Field-Level Training Notes\n`);
      const seen = new Set<string>();
      for (const t of fieldLevel) {
        const key = (t.fieldName || "").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(`- **${t.fieldName}**: ${t.content}`);
      }
      parts.push("");
    }
  }

  // Section 3: Resolved Q&A
  if (questions.length > 0) {
    parts.push(`## Resolved Questions\n`);
    for (const q of questions) {
      const fieldLabel = q.fieldName || "Entity-level";
      parts.push(`- **${fieldLabel}**: Q: "${q.question}"`);
      parts.push(`  A: ${q.answer}`);
    }
    parts.push("");
  }

  // Section 4: Thread Decisions — resolved comment thread discussions
  if (threadDecisions.length > 0) {
    parts.push(`## Team Decisions (from discussion threads)\n`);
    parts.push(`These are decisions made by the team in resolved discussion threads. Treat them as authoritative — do NOT re-ask questions that have already been decided here.\n`);
    for (const td of threadDecisions) {
      const fieldLabel = td.fieldName || "Entity-level";
      const subject = td.subject ? ` — "${td.subject}"` : "";
      parts.push(`### ${fieldLabel}${subject}\n`);
      for (const c of td.comments) {
        parts.push(`> ${c}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n").trim();
}

/**
 * Find or create the Entity Knowledge context doc.
 * Always replaces the content (not append).
 */
async function upsertContext(
  workspaceId: string,
  entityId: string,
  entityName: string,
  content: string,
): Promise<{ contextId: string; created: boolean }> {
  const now = new Date().toISOString();
  const tokenCount = estimateTokens(content);

  const existing = (await db
    .select()
    .from(context)
    .where(
      and(
        eq(context.workspaceId, workspaceId),
        eq(context.category, CATEGORY),
        eq(context.subcategory, SUBCATEGORY),
        eq(context.entityId, entityId),
      ),
    )
    )[0];

  if (existing) {
    await db.update(context)
      .set({ content, tokenCount, isActive: true, updatedAt: now })
      .where(eq(context.id, existing.id))
      ;
    return { contextId: existing.id, created: false };
  }

  const [inserted] = await db
    .insert(context)
    .values({
      workspaceId,
      name: `Entity Knowledge > ${entityName}`,
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      entityId,
      content,
      contentFormat: "markdown",
      tokenCount,
      tags: ["entity_knowledge", entityName.toLowerCase()],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    ;

  return { contextId: inserted.id, created: true };
}

/**
 * Deactivate an existing Entity Knowledge doc when there's nothing to show.
 */
async function deactivateExisting(workspaceId: string, entityId: string): Promise<void> {
  await db.update(context)
    .set({ isActive: false, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(context.workspaceId, workspaceId),
        eq(context.category, CATEGORY),
        eq(context.subcategory, SUBCATEGORY),
        eq(context.entityId, entityId),
      ),
    )
    ;
}

/**
 * Link the Entity Knowledge context to all matching skills as "reference".
 */
async function linkToMatchingSkills(
  workspaceId: string,
  contextId: string,
  entityName: string,
): Promise<void> {
  const matched = await matchSkills(workspaceId, entityName);

  for (const s of matched) {
    const exists = (await db
      .select({ id: skillContext.id })
      .from(skillContext)
      .where(
        and(eq(skillContext.skillId, s.id), eq(skillContext.contextId, contextId)),
      )
      )[0];

    if (!exists) {
      await db.insert(skillContext)
        .values({
          skillId: s.id,
          contextId,
          role: "reference",
          sortOrder: 100,
          notes: "Auto-linked entity knowledge",
        })
        ;
    }
  }
}
