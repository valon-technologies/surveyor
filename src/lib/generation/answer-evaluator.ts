import { db } from "@/lib/db";
import { question, questionReply, entity, field } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { resolveProvider } from "./provider-resolver";

/** Maximum AI follow-up replies per question (prevents loops). */
const MAX_AI_FOLLOWUPS = 2;

interface EvaluateResolutionInput {
  workspaceId: string;
  questionId: string;
  resolverUserId: string;
  resolverName: string;
  resolutionText: string;
}

interface EvaluationResult {
  verdict: "sufficient" | "insufficient";
  followUp?: string;
}

/**
 * Evaluate whether a human's resolution answer is specific enough.
 * If insufficient, posts an AI follow-up reply and reopens the question.
 *
 * Designed to be called fire-and-forget from the resolve endpoint.
 */
export async function evaluateResolution(
  input: EvaluateResolutionInput
): Promise<void> {
  const { workspaceId, questionId, resolverUserId, resolverName, resolutionText } = input;

  // 1. Load question — guard: only evaluate LLM-asked questions
  const q = db
    .select()
    .from(question)
    .where(and(eq(question.id, questionId), eq(question.workspaceId, workspaceId)))
    .get();

  if (!q || q.askedBy !== "llm") return;

  // 2. Count existing AI follow-ups — enforce loop cap
  const replies = db
    .select()
    .from(questionReply)
    .where(eq(questionReply.questionId, questionId))
    .orderBy(asc(questionReply.createdAt))
    .all();

  const aiFollowupCount = replies.filter(
    (r) => r.authorRole === "llm" && !r.isResolution
  ).length;

  if (aiFollowupCount >= MAX_AI_FOLLOWUPS) return;

  // 3. Resolve entity/field names for context
  let entityName = "";
  let fieldName = "";

  if (q.entityId) {
    const e = db.select({ name: entity.name }).from(entity)
      .where(eq(entity.id, q.entityId)).get();
    entityName = e?.name || "";
  }
  if (q.fieldId) {
    const f = db.select({ name: field.name }).from(field)
      .where(eq(field.id, q.fieldId)).get();
    fieldName = f?.name || "";
  }

  // 4. Resolve LLM provider using the resolver's API key
  const { provider } = resolveProvider(resolverUserId);

  // 5. Build conversation context from replies
  const threadContext = replies
    .map((r) => `[${r.authorRole}] ${r.authorName}: ${r.body}`)
    .join("\n");

  // 6. Call LLM with focused evaluation prompt
  const fieldContext = fieldName
    ? `Entity: ${entityName}, Field: ${fieldName}`
    : `Entity: ${entityName}`;

  const systemMessage = `You evaluate whether a human's answer provides enough specificity to resolve a data mapping question.

You must respond with ONLY a JSON object (no markdown, no explanation) in this exact format:
{"verdict": "sufficient"} or {"verdict": "insufficient", "followUp": "<your follow-up question>"}

Guidelines:
- "sufficient": The answer is specific enough to act on. It names concrete fields, tables, values, or logic.
- "insufficient": The answer is vague, partial, defers to someone else, raises new ambiguity, or says "yes do that" without specifying what "that" means.
- If insufficient, write a concise follow-up question (1-2 sentences) that asks for the specific missing detail.
- Be pragmatic: short but clear answers are fine. Only flag genuinely ambiguous or incomplete responses.`;

  const userMessage = `## Context
${fieldContext}

## Original question (asked by AI)
${q.question}

## Reply thread
${threadContext || "(no prior replies)"}

## Resolution answer
${resolutionText}

Evaluate whether this resolution is specific enough to close the question.`;

  let result: EvaluationResult;

  try {
    const response = await provider.generateCompletion({
      systemMessage,
      userMessage,
      temperature: 0,
      maxTokens: 500,
    });

    result = parseEvaluationResponse(response.content);
  } catch (err) {
    console.warn("[answer-evaluator] LLM call failed:", err);
    return; // Fail silently — question stays resolved
  }

  // 7. If sufficient, no action needed
  if (result.verdict === "sufficient") return;

  // 8. Post AI follow-up reply
  const followUpBody = `@${resolverName} ${result.followUp}`;

  db.insert(questionReply)
    .values({
      questionId,
      authorId: null,
      authorName: "Surveyor AI",
      authorRole: "llm",
      body: followUpBody,
      isResolution: false,
    })
    .run();

  // 9. Reopen the question (only if still resolved — human may have already reopened)
  const current = db
    .select({ status: question.status, replyCount: question.replyCount })
    .from(question)
    .where(eq(question.id, questionId))
    .get();

  if (!current) return;

  const now = new Date().toISOString();

  if (current.status === "resolved") {
    db.update(question)
      .set({
        status: "open",
        resolvedBy: null,
        resolvedByName: null,
        resolvedAt: null,
        answer: null,
        answeredBy: null,
        replyCount: current.replyCount + 1,
        updatedAt: now,
      })
      .where(eq(question.id, questionId))
      .run();
  } else {
    // Already open — just bump the reply count
    db.update(question)
      .set({
        replyCount: current.replyCount + 1,
        updatedAt: now,
      })
      .where(eq(question.id, questionId))
      .run();
  }
}

/**
 * Parse LLM response into structured evaluation result.
 * Falls back to "sufficient" on any parse error (safe default).
 */
function parseEvaluationResponse(content: string): EvaluationResult {
  try {
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { verdict: "sufficient" };

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.verdict === "insufficient" && typeof parsed.followUp === "string") {
      return { verdict: "insufficient", followUp: parsed.followUp };
    }

    return { verdict: "sufficient" };
  } catch {
    return { verdict: "sufficient" };
  }
}
