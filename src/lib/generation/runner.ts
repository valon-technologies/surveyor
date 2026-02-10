import { db } from "@/lib/db";
import { entity, field, fieldMapping, generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { assembleContext } from "./context-assembler";
import { buildPrompt } from "./prompt-builder";
import { parseGenerationOutput } from "./output-parser";
import { resolveProvider, getTokenBudget } from "./provider-resolver";
import type { ParseResult, GenerationStartResult } from "@/types/generation";
import type { LLMProvider } from "@/lib/llm/provider";

interface RunGenerationInput {
  workspaceId: string;
  userId: string;
  entityId: string;
  fieldIds?: string[];
  generationType: string;
  preferredProvider?: "claude" | "openai";
  model?: string;
}

interface RunGenerationResult {
  generationId: string;
  status: "completed" | "failed";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  parsedOutput: ParseResult | null;
  error?: string;
}

interface PreparedGeneration {
  generationId: string;
  entityId: string;
  entityName: string;
  fieldCount: number;
  providerName: string;
  model: string | undefined;
  provider: LLMProvider;
  systemMessage: string;
  userMessage: string;
  targetFields: { id: string; name: string; entityId: string }[];
  sourceEntities: { id: string; name: string }[];
  sourceFields: { id: string; name: string; entityId: string }[];
}

/**
 * Synchronous setup: validates, loads data, assembles context, creates generation record.
 * Returns immediately with generation metadata + prepared data for async execution.
 */
export function startGeneration(
  input: RunGenerationInput
): { startResult: GenerationStartResult; prepared: PreparedGeneration } {
  const { workspaceId, userId, entityId, fieldIds, preferredProvider } = input;

  // 1. Check for concurrent generation on this entity
  const running = db
    .select()
    .from(generation)
    .where(
      and(
        eq(generation.workspaceId, workspaceId),
        eq(generation.entityId, entityId),
        eq(generation.status, "running")
      )
    )
    .get();

  if (running) {
    throw new Error(
      "A generation is already running for this entity. Please wait for it to complete."
    );
  }

  // 2. Load target entity
  const targetEntity = db
    .select()
    .from(entity)
    .where(and(eq(entity.id, entityId), eq(entity.workspaceId, workspaceId)))
    .get();

  if (!targetEntity) {
    throw new Error("Entity not found");
  }

  // 3. Load target fields
  let targetFields = db
    .select()
    .from(field)
    .where(eq(field.entityId, entityId))
    .orderBy(field.sortOrder)
    .all();

  if (fieldIds?.length) {
    const idSet = new Set(fieldIds);
    targetFields = targetFields.filter((f) => idSet.has(f.id));
  } else {
    const existingMappings = db
      .select({ targetFieldId: fieldMapping.targetFieldId })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true)
        )
      )
      .all();

    const mappedIds = new Set(existingMappings.map((m) => m.targetFieldId));
    targetFields = targetFields.filter((f) => !mappedIds.has(f.id));
  }

  if (targetFields.length === 0) {
    throw new Error("No fields to generate mappings for");
  }

  // 4. Load source entities and fields
  const sourceEntities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();

  const sourceEntityIds = sourceEntities.map((e) => e.id);
  const sourceFields =
    sourceEntityIds.length > 0
      ? db
          .select()
          .from(field)
          .all()
          .filter((f) => sourceEntityIds.includes(f.entityId))
      : [];

  // 5. Resolve provider
  const { provider, providerName } = resolveProvider(userId, preferredProvider);

  // 6. Assemble context
  const tokenBudget = getTokenBudget(providerName);
  const assembledCtx = assembleContext(workspaceId, targetEntity.name, tokenBudget);

  // 7. Build prompt
  const { systemMessage, userMessage } = buildPrompt({
    entityName: targetEntity.displayName || targetEntity.name,
    entityDescription: targetEntity.description,
    targetFields: targetFields.map((f) => ({
      name: f.name,
      dataType: f.dataType,
      isRequired: f.isRequired,
      isKey: f.isKey,
      description: f.description,
      enumValues: f.enumValues,
      sampleValues: f.sampleValues,
    })),
    assembledContext: assembledCtx,
  });

  // 8. Create generation record
  const generationId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(generation)
    .values({
      id: generationId,
      workspaceId,
      entityId,
      generationType: input.generationType,
      status: "running",
      provider: providerName,
      model: input.model || null,
      promptSnapshot: {
        systemMessage,
        userMessage,
        skillsUsed: assembledCtx.skillsUsed.map((s) => s.name),
      },
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    startResult: {
      generationId,
      status: "running",
      entityId,
      entityName: targetEntity.displayName || targetEntity.name,
      fieldCount: targetFields.length,
      provider: providerName,
      model: input.model || providerName,
    },
    prepared: {
      generationId,
      entityId,
      entityName: targetEntity.displayName || targetEntity.name,
      fieldCount: targetFields.length,
      providerName,
      model: input.model,
      provider,
      systemMessage,
      userMessage,
      targetFields: targetFields.map((f) => ({
        id: f.id,
        name: f.name,
        entityId: f.entityId,
      })),
      sourceEntities: sourceEntities.map((e) => ({ id: e.id, name: e.name })),
      sourceFields: sourceFields.map((f) => ({
        id: f.id,
        name: f.name,
        entityId: f.entityId,
      })),
    },
  };
}

/**
 * Async execution: calls LLM, parses output, updates generation record.
 * Designed to be called without await (fire-and-forget).
 */
export async function executeGeneration(prepared: PreparedGeneration): Promise<void> {
  const {
    generationId,
    provider,
    model,
    systemMessage,
    userMessage,
    targetFields,
    sourceEntities,
    sourceFields,
  } = prepared;

  const startTime = Date.now();
  try {
    const estimatedOutputTokens = Math.max(4096, targetFields.length * 200);
    const response = await provider.generateCompletion({
      systemMessage,
      userMessage,
      model,
      maxTokens: Math.min(estimatedOutputTokens, 16384),
      temperature: 0,
    });

    const durationMs = Date.now() - startTime;

    const parsedOutput = parseGenerationOutput(response.content, {
      targetFields,
      sourceEntities,
      sourceFields,
      requestedFieldNames: targetFields.map((f) => f.name),
    });

    db.update(generation)
      .set({
        status: "completed",
        model: response.model,
        output: response.content,
        outputParsed: parsedOutput as unknown as Record<string, unknown>,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        durationMs,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(generation.id, generationId))
      .run();
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    db.update(generation)
      .set({
        status: "failed",
        error: errorMessage,
        durationMs,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(generation.id, generationId))
      .run();
  }
}

/**
 * Convenience wrapper: runs start + execute synchronously (blocking).
 * Used for cases where you want to wait for the result.
 */
export async function runGeneration(
  input: RunGenerationInput
): Promise<RunGenerationResult> {
  const { startResult, prepared } = startGeneration(input);

  await executeGeneration(prepared);

  // Read the completed record from DB
  const gen = db
    .select()
    .from(generation)
    .where(eq(generation.id, startResult.generationId))
    .get();

  if (!gen) {
    throw new Error("Generation record not found after execution");
  }

  return {
    generationId: gen.id,
    status: gen.status as "completed" | "failed",
    provider: gen.provider || startResult.provider,
    model: gen.model || "",
    inputTokens: gen.inputTokens || 0,
    outputTokens: gen.outputTokens || 0,
    durationMs: gen.durationMs || 0,
    parsedOutput: (gen.outputParsed as unknown as ParseResult) || null,
    error: gen.error || undefined,
  };
}
