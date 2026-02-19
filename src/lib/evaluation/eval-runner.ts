import { db } from "@/lib/db";
import { question, questionReply, entity, field, evaluation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { assembleContext } from "@/lib/generation/context-assembler";
import { resolveProvider, getTokenBudget } from "@/lib/generation/provider-resolver";
import { tokenOverlap } from "./metrics";
import { judgeAnswer } from "./llm-judge";
import type { EvalResult } from "@/types/evaluation";

interface EvaluateQuestionParams {
  workspaceId: string;
  questionId: string;
  userId: string;
  runJudge?: boolean;
}

/**
 * Evaluate AI answer quality for a resolved question by:
 * 1. Loading the human resolution answer
 * 2. Assembling context with query-aware retrieval
 * 3. Generating an AI answer
 * 4. Computing token overlap (Jaccard)
 * 5. Optionally running LLM judge
 */
export async function evaluateQuestion(
  params: EvaluateQuestionParams
): Promise<EvalResult> {
  const { workspaceId, questionId, userId, runJudge = false } = params;

  // Load question
  const q = db
    .select()
    .from(question)
    .where(and(eq(question.id, questionId), eq(question.workspaceId, workspaceId)))
    .get();

  if (!q) throw new Error(`Question ${questionId} not found`);
  if (q.status !== "resolved") throw new Error("Question is not resolved");

  // Load human resolution answer
  const resolution = db
    .select()
    .from(questionReply)
    .where(
      and(
        eq(questionReply.questionId, questionId),
        eq(questionReply.isResolution, true)
      )
    )
    .get();

  const humanAnswer = resolution?.body || q.answer;
  if (!humanAnswer) throw new Error("No human answer found for question");

  // Load entity name
  let entityName = "Unknown";
  if (q.entityId) {
    const e = db
      .select({ name: entity.name })
      .from(entity)
      .where(eq(entity.id, q.entityId))
      .get();
    entityName = e?.name || entityName;
  }

  // Load field name if available
  let fieldName: string | null = null;
  if (q.fieldId) {
    const f = db
      .select({ name: field.name })
      .from(field)
      .where(eq(field.id, q.fieldId))
      .get();
    fieldName = f?.name || null;
  }

  // Resolve LLM provider
  const { provider, providerName } = resolveProvider(userId);
  const tokenBudget = getTokenBudget(providerName);

  // Assemble context with query-aware retrieval
  const assembled = assembleContext(
    workspaceId,
    entityName,
    tokenBudget,
    q.question
  );

  // Build context text for the prompt
  const allContexts = [
    ...assembled.primaryContexts,
    ...assembled.referenceContexts,
    ...assembled.supplementaryContexts,
  ];
  const contextText = allContexts
    .map((c) => `## ${c.name}\n${c.content}`)
    .join("\n\n---\n\n");

  // Generate AI answer
  const fieldContext = fieldName ? ` for field "${fieldName}"` : "";
  const systemMessage = [
    "You are an expert data mapping analyst. Answer the following question using the provided context.",
    "Be specific and concise. Reference source tables and fields when relevant.",
    "",
    "## Context",
    contextText,
  ].join("\n");

  const userMessage = `Question about ${entityName}${fieldContext}: ${q.question}`;

  const startTime = Date.now();
  const response = await provider.generateCompletion({
    systemMessage,
    userMessage,
    temperature: 0,
    maxTokens: 2000,
  });
  const durationMs = Date.now() - startTime;

  const aiAnswer = response.content;

  // Compute token overlap
  const overlap = tokenOverlap(humanAnswer, aiAnswer);

  // Create evaluation record
  const evalData: Record<string, unknown> = {
    workspaceId,
    questionId,
    humanAnswer,
    aiAnswer,
    tokenOverlap: overlap,
    contextUsed: {
      skillsUsed: assembled.skillsUsed.map((s) => s.name),
      contextIds: allContexts.map((c) => c.id),
      totalTokens: assembled.totalTokens,
    },
    aiProvider: providerName,
    aiModel: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    generationDurationMs: durationMs,
    status: "completed",
  };

  // Optionally run LLM judge
  if (runJudge) {
    const judgeResult = await judgeAnswer({
      question: q.question,
      humanAnswer,
      aiAnswer,
      provider,
    });
    evalData.judgeScore = judgeResult.score;
    evalData.judgeReasoning = judgeResult.reasoning;
    evalData.judgeModel = judgeResult.model;
  }

  const [inserted] = db
    .insert(evaluation)
    .values(evalData as typeof evaluation.$inferInsert)
    .returning()
    .all();

  return {
    evaluationId: inserted.id,
    questionId,
    humanAnswer,
    aiAnswer,
    tokenOverlap: overlap,
    judgeScore: (evalData.judgeScore as number) || undefined,
    judgeReasoning: (evalData.judgeReasoning as string) || undefined,
    judgeModel: (evalData.judgeModel as string) || undefined,
    contextUsed: evalData.contextUsed as EvalResult["contextUsed"],
    aiProvider: providerName,
    aiModel: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    generationDurationMs: durationMs,
  };
}
