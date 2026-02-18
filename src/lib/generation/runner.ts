import { db } from "@/lib/db";
import { entity, field, fieldMapping, generation, entityPipeline, learning } from "@/lib/db/schema";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import { assembleContext } from "./context-assembler";
import { buildPrompt, buildYamlPrompt } from "./prompt-builder";
import { parseGenerationOutput, parseYamlOutput, type YamlParseResult } from "./output-parser";
import { resolveProvider, getTokenBudget } from "./provider-resolver";
import { validateYamlOutput, formatValidationFeedback, type ValidationResult, type TargetFieldMeta } from "./yaml-validator";
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
  outputFormat?: "json" | "yaml";
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
  targetFieldMeta: TargetFieldMeta[];
  sourceEntities: { id: string; name: string }[];
  sourceFields: { id: string; name: string; entityId: string }[];
  outputFormat: "json" | "yaml";
}

/**
 * Sync setup: validates, loads data, assembles context, creates generation record.
 * Returns with generation metadata + prepared data for async execution.
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

  // 4. Load source entities and fields — pre-filter to relevant tables
  const allSourceEntities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();

  // Identify relevant source tables from pipeline + existing mappings
  const relevantSourceIds = new Set<string>();

  // Signal 1: entity pipeline declared sources
  const pipeline = db
    .select()
    .from(entityPipeline)
    .where(
      and(
        eq(entityPipeline.entityId, entityId),
        eq(entityPipeline.isLatest, true)
      )
    )
    .get();

  if (pipeline?.sources) {
    const pipelineSources = pipeline.sources as { name: string; alias: string; table: string }[];
    for (const ps of pipelineSources) {
      // Match pipeline source table names to source entities
      const match = allSourceEntities.find(
        (e) =>
          e.name === ps.table ||
          e.name === ps.name ||
          (e.displayName && (e.displayName === ps.table || e.displayName === ps.name))
      );
      if (match) relevantSourceIds.add(match.id);
    }
  }

  // Signal 2: existing sibling mappings' source entities
  const siblingMappings = db
    .select({ sourceEntityId: fieldMapping.sourceEntityId })
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true)
      )
    )
    .all();

  for (const sm of siblingMappings) {
    if (sm.sourceEntityId) relevantSourceIds.add(sm.sourceEntityId);
  }

  // Use filtered set if we found relevant sources, otherwise fall back to all
  const sourceEntities =
    relevantSourceIds.size > 0
      ? allSourceEntities.filter((e) => relevantSourceIds.has(e.id))
      : allSourceEntities;

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

  // 7. Query learnings for this entity
  const entityLearnings = db
    .select({ content: learning.content })
    .from(learning)
    .where(
      and(
        eq(learning.workspaceId, workspaceId),
        or(
          eq(learning.entityId, entityId),
          and(isNull(learning.entityId), eq(learning.scope, "workspace"))
        )
      )
    )
    .orderBy(desc(learning.createdAt))
    .limit(15)
    .all();

  const learningTexts = entityLearnings.map((l) => l.content);

  // 8. Build prompt (reshape source data for the LLM prompt)
  const outputFormat = input.outputFormat ?? "json";
  const promptBuilder = outputFormat === "yaml" ? buildYamlPrompt : buildPrompt;

  const sourceSchema = sourceEntities.map((se) => ({
    entityName: se.name,
    fields: sourceFields
      .filter((sf) => sf.entityId === se.id)
      .map((sf) => ({ name: sf.name, dataType: sf.dataType })),
  }));

  const { systemMessage, userMessage } = promptBuilder({
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
    sourceSchema,
    learnings: learningTexts,
  });

  // 9. Create generation record
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
      targetFieldMeta: targetFields.map((f) => ({
        name: f.name,
        isRequired: f.isRequired,
        enumValues: f.enumValues,
      })),
      sourceEntities: sourceEntities.map((e) => ({ id: e.id, name: e.name })),
      sourceFields: sourceFields.map((f) => ({
        id: f.id,
        name: f.name,
        entityId: f.entityId,
      })),
      outputFormat,
    },
  };
}

/**
 * Persist an entityPipeline record from a parsed YAML result.
 * Marks any existing latest pipeline for this entity as not latest.
 */
export function persistEntityPipeline(opts: {
  workspaceId: string;
  entityId: string;
  yamlResult: YamlParseResult;
  generationId: string;
  batchRunId?: string;
}): void {
  const { workspaceId, entityId, yamlResult, generationId, batchRunId } = opts;
  const parsed = yamlResult.yamlParsed;
  if (!parsed) return; // schema validation failed, nothing to persist

  const now = new Date().toISOString();

  // Find existing latest pipeline version for this entity
  const existing = db
    .select()
    .from(entityPipeline)
    .where(
      and(
        eq(entityPipeline.entityId, entityId),
        eq(entityPipeline.isLatest, true)
      )
    )
    .get();

  // Mark old version as not latest
  if (existing) {
    db.update(entityPipeline)
      .set({ isLatest: false, updatedAt: now })
      .where(eq(entityPipeline.id, existing.id))
      .run();
  }

  // Extract sources with resolved table names
  const sources = parsed.sources.map((s) => ({
    name: s.name,
    alias: s.alias,
    table: s.pipe_file?.table ?? s.staging?.table ?? s.name,
    filters: s.filters ?? undefined,
  }));

  // Extract joins
  const joins = parsed.joins
    ? (parsed.joins as { left?: string; right?: string; on?: string[]; how?: string }[]).map((j) => ({
        left: j.left ?? "",
        right: j.right ?? "",
        on: Array.isArray(j.on) ? j.on : [],
        how: j.how ?? "left",
      }))
    : null;

  const structureType = parsed.concat ? "assembly" : "flat";

  db.insert(entityPipeline)
    .values({
      workspaceId,
      entityId,
      version: existing ? existing.version + 1 : 1,
      parentId: existing?.id ?? null,
      isLatest: true,
      yamlSpec: yamlResult.yamlOutput,
      tableName: parsed.table,
      primaryKey: parsed.primary_key ?? null,
      sources,
      joins,
      concat: parsed.concat as Record<string, unknown> | null ?? null,
      structureType,
      isStale: false,
      generationId,
      batchRunId: batchRunId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
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
    targetFieldMeta,
    sourceEntities,
    sourceFields,
    outputFormat,
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

    const resolutionCtx = {
      targetFields,
      sourceEntities,
      sourceFields,
      requestedFieldNames: targetFields.map((f) => f.name),
    };
    const parsedOutput = outputFormat === "yaml"
      ? parseYamlOutput(response.content, resolutionCtx)
      : parseGenerationOutput(response.content, resolutionCtx);

    // Validate + correct loop (YAML path only)
    let finalParsedOutput = parsedOutput;
    let finalResponse = response;
    let validationResult: ValidationResult | null = null;

    if (outputFormat === "yaml") {
      validationResult = validateYamlOutput(
        parsedOutput as YamlParseResult,
        targetFieldMeta,
      );

      // Correction attempt if validation fails
      if (!validationResult.valid) {
        const feedback = formatValidationFeedback(validationResult.issues);
        try {
          const correctionResponse = await provider.generateCompletion({
            systemMessage,
            userMessage: userMessage + "\n\n" + feedback,
            model,
            maxTokens: Math.min(estimatedOutputTokens, 16384),
            temperature: 0,
          });

          const correctedParsed = parseYamlOutput(correctionResponse.content, resolutionCtx);
          const revalidation = validateYamlOutput(correctedParsed, targetFieldMeta);

          // Pick whichever is better
          if (revalidation.score > validationResult.score) {
            finalParsedOutput = correctedParsed;
            finalResponse = correctionResponse;
            validationResult = revalidation;
            console.log(
              `[runner] Correction improved score: ${validationResult.score} → ${revalidation.score} for generation ${generationId}`,
            );
          } else {
            console.log(
              `[runner] Correction did not improve (original: ${validationResult.score}, corrected: ${revalidation.score})`,
            );
          }
        } catch (correctionErr) {
          console.warn("[runner] Correction attempt failed, keeping original:", correctionErr);
        }
      }
    }

    db.update(generation)
      .set({
        status: "completed",
        model: finalResponse.model,
        output: finalResponse.content,
        outputParsed: finalParsedOutput as unknown as Record<string, unknown>,
        inputTokens: finalResponse.inputTokens,
        outputTokens: finalResponse.outputTokens,
        validationScore: validationResult?.score ?? null,
        validationIssues: validationResult?.issues as unknown as Record<string, unknown>[] ?? null,
        durationMs,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(generation.id, generationId))
      .run();

    // Persist entity pipeline if YAML format
    if (outputFormat === "yaml") {
      try {
        const yamlResult = finalParsedOutput as unknown as YamlParseResult;
        if (yamlResult.yamlParsed) {
          // Read the generation to get workspaceId
          const gen = db.select().from(generation).where(eq(generation.id, generationId)).get();
          if (gen?.entityId) {
            persistEntityPipeline({
              workspaceId: gen.workspaceId,
              entityId: gen.entityId,
              yamlResult,
              generationId,
            });
          }
        }
      } catch (pipelineErr) {
        console.warn("[runner] Failed to persist entity pipeline:", pipelineErr);
      }
    }
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
 * Convenience wrapper: runs start + execute (blocking).
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
