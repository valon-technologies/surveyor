import { db, withTransaction } from "@/lib/db";
import { entity, field, fieldMapping, generation, entityPipeline, skillContext as skillContextTable, context as contextTable, learning, workspace } from "@/lib/db/schema";
import { createPipelineVersion } from "@/lib/db/copy-on-write";
import { eq, and, desc, inArray } from "drizzle-orm";
import { assembleContext, matchSkills } from "./context-assembler";
import { buildPrompt, buildYamlPrompt } from "./prompt-builder";
import { parseGenerationOutput, parseYamlOutput, type YamlParseResult } from "./output-parser";
import { resolveProvider, getTokenBudget } from "./provider-resolver";
import { validateYamlOutput, formatValidationFeedback, type ValidationResult, type TargetFieldMeta } from "./yaml-validator";
import type { ParseResult, GenerationStartResult } from "@/types/generation";
import type { LLMProvider, ToolDefinition, ToolCall } from "@/lib/llm/provider";
import type { BigQueryConfig } from "@/types/workspace";
import {
  getBigQueryToolDefinition,
  executeBigQueryTool,
  formatToolResultForLLM,
} from "@/lib/bigquery/tool-executor";
import {
  getSourceSchemaToolDefinition,
  executeSourceSchemaSearch,
  formatSourceSchemaForLLM,
  getReferenceDocsToolDefinition,
  executeReferenceDocRetrieval,
  formatReferenceDocsForLLM,
  type SourceSchemaInput,
  type ReferenceDocsInput,
} from "@/lib/rag";

interface RunGenerationInput {
  workspaceId: string;
  userId: string;
  entityId: string;
  fieldIds?: string[];
  generationType: string;
  preferredProvider?: "claude" | "openai";
  model?: string;
  outputFormat?: "json" | "yaml";
  bqConfig?: BigQueryConfig;
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
  tools?: ToolDefinition[];
  bqConfig?: BigQueryConfig;
  workspaceId?: string;
}

/**
 * Sync setup: validates, loads data, assembles context, creates generation record.
 * Returns with generation metadata + prepared data for async execution.
 */
export function startGeneration(
  input: RunGenerationInput
): { startResult: GenerationStartResult; prepared: PreparedGeneration } {
  const { workspaceId, userId, entityId, fieldIds, preferredProvider } = input;

  // 1. Check for concurrent generation on this entity (inside transaction to close TOCTOU)
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

  // Signal 2: existing sibling mappings' source entities (same entity only)
  // Collect all field IDs for this entity to scope the lookup
  const entityFieldIds = db
    .select({ id: field.id })
    .from(field)
    .where(eq(field.entityId, entityId))
    .all()
    .map((f) => f.id);

  const siblingMappings = entityFieldIds.length > 0
    ? db
        .select({ sourceEntityId: fieldMapping.sourceEntityId })
        .from(fieldMapping)
        .where(
          and(
            eq(fieldMapping.workspaceId, workspaceId),
            eq(fieldMapping.isLatest, true),
            inArray(fieldMapping.targetFieldId, entityFieldIds)
          )
        )
        .all()
    : [];

  for (const sm of siblingMappings) {
    if (sm.sourceEntityId) relevantSourceIds.add(sm.sourceEntityId);
  }

  // Signal 3: skill-matched primary contexts identify relevant source tables
  // If signals 1+2 found nothing, use skill matching to extract ServiceMac
  // table names from primary context docs (e.g. "ServiceMac > Tables > LoanInfo").
  if (relevantSourceIds.size === 0) {
    const SM_TABLE_PREFIX = "ServiceMac > Tables > ";
    const matched = matchSkills(workspaceId, targetEntity.name);
    if (matched.length > 0) {
      const seenContextIds = new Set<string>();
      for (const s of matched) {
        const scs = db
          .select({ contextId: skillContextTable.contextId })
          .from(skillContextTable)
          .where(and(eq(skillContextTable.skillId, s.id), eq(skillContextTable.role, "primary")))
          .all();

        for (const sc of scs) {
          if (seenContextIds.has(sc.contextId)) continue;
          seenContextIds.add(sc.contextId);

          const ctx = db
            .select({ name: contextTable.name })
            .from(contextTable)
            .where(eq(contextTable.id, sc.contextId))
            .get();

          if (ctx?.name?.startsWith(SM_TABLE_PREFIX)) {
            const tableName = ctx.name.slice(SM_TABLE_PREFIX.length);
            const tableNameNorm = tableName.toLowerCase().replace(/\s+/g, "");
            const match = allSourceEntities.find(
              (e) =>
                e.name === tableName ||
                e.displayName === tableName ||
                e.name.toLowerCase() === tableNameNorm ||
                (e.displayName && e.displayName.toLowerCase().replace(/\s+/g, "") === tableNameNorm)
            );
            if (match) relevantSourceIds.add(match.id);
          }
        }
      }
    }
  }

  // Always include ALL source entities so the LLM can discover cross-table
  // mappings. Relevant tables (from pipeline/mappings/skills) get full
  // descriptions; the rest get compact name+type only.
  const sourceEntities = allSourceEntities;

  const allSourceFields = db
    .select()
    .from(field)
    .all()
    .filter((f) => allSourceEntities.some((e) => e.id === f.entityId));

  const sourceFields = allSourceFields;

  // 5. Resolve provider
  const { provider, providerName } = resolveProvider(userId, preferredProvider);

  // 6. Assemble context
  // Pass source table names from the previous generation's YAML output so their
  // enum contexts are auto-included. This is targeted — only tables the LLM
  // actually used, not every source table in the workspace.
  const tokenBudget = getTokenBudget(providerName);
  let yamlSourceTableNames: string[] | undefined;

  const lastCompletedGen = db
    .select({ outputParsed: generation.outputParsed })
    .from(generation)
    .where(
      and(
        eq(generation.entityId, entityId),
        eq(generation.status, "completed"),
      )
    )
    .orderBy(desc(generation.createdAt))
    .get();

  if (lastCompletedGen?.outputParsed) {
    try {
      const parsed = lastCompletedGen.outputParsed as Record<string, unknown>;
      const yamlParsed = parsed.yamlParsed as { sources?: { table?: string }[] } | undefined;
      if (yamlParsed?.sources) {
        yamlSourceTableNames = yamlParsed.sources
          .map((s) => s.table)
          .filter((t): t is string => !!t);
      }
    } catch { /* ignore parse errors */ }
  }

  const assembledCtx = assembleContext(
    workspaceId, targetEntity.name, tokenBudget, undefined,
    yamlSourceTableNames?.length ? yamlSourceTableNames : undefined,
  );

  // 7. Build prompt (reshape source data for the LLM prompt)
  // Note: learnings are now surfaced via Entity Knowledge context docs
  // through the normal RAG/skill retrieval path — no direct injection.
  const outputFormat = input.outputFormat ?? "json";
  const promptBuilder = outputFormat === "yaml" ? buildYamlPrompt : buildPrompt;

  // Load workspace-scoped rules from the learning table
  const workspaceRules = db
    .select({ content: learning.content })
    .from(learning)
    .where(
      and(
        eq(learning.workspaceId, workspaceId),
        eq(learning.scope, "workspace")
      )
    )
    .orderBy(desc(learning.createdAt))
    .limit(20)
    .all()
    .map((l) => l.content);

  // Include descriptions for relevant (skill-matched) tables; name+type only for others
  // to keep prompt within token limits while giving the LLM full source visibility.
  const sourceSchema = sourceEntities.map((se) => ({
    entityName: se.name,
    fields: sourceFields
      .filter((sf) => sf.entityId === se.id)
      .map((sf) => ({
        name: sf.name,
        dataType: sf.dataType,
        description: relevantSourceIds.has(se.id) ? sf.description : null,
      })),
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
    workspaceRules: workspaceRules.length > 0 ? workspaceRules : undefined,
    workspaceId,
  });

  // 8. Optionally attach tool instructions to the system message when BQ is available
  let finalSystemMessage = systemMessage;
  const tools: ToolDefinition[] = [];

  if (input.bqConfig) {
    tools.push(
      getBigQueryToolDefinition(input.bqConfig),
      getSourceSchemaToolDefinition(),
      getReferenceDocsToolDefinition(),
    );

    finalSystemMessage += `

TOOL ACCESS:
You have tools available to verify your mappings against real data. Use them BEFORE finalizing.

1. \`query_bigquery\` — Run read-only SQL against the source data (dataset: ${input.bqConfig.projectId}.${input.bqConfig.sourceDataset})
2. \`search_source_schema\` — Search source tables/fields by keyword
3. \`get_reference_docs\` — Retrieve domain docs, business rules, enum references

WHEN TO USE TOOLS:
- Use query_bigquery to check distinct values, null rates, or verify column existence
- Use search_source_schema when you can't find a source field in the provided schema
- Use get_reference_docs for enum code lookups or business rule clarification
- Always use LIMIT (max 25 rows) in BQ queries
- Summarize tool results concisely — don't repeat raw data in your output`;
  }

  // 9. Atomic check + create generation record (closes TOCTOU race)
  const generationId = crypto.randomUUID();
  const now = new Date().toISOString();

  withTransaction(() => {
    // Re-check inside transaction — the early check above is just for fast-fail
    const concurrent = db
      .select()
      .from(generation)
      .where(
        and(
          eq(generation.workspaceId, workspaceId),
          eq(generation.entityId, entityId),
          eq(generation.status, "running"),
        ),
      )
      .get();

    if (concurrent) {
      throw new Error(
        "A generation is already running for this entity. Please wait for it to complete.",
      );
    }

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
          systemMessage: finalSystemMessage,
          userMessage,
          skillsUsed: assembledCtx.skillsUsed.map((s) => s.name),
        },
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

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
      systemMessage: finalSystemMessage,
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
      tools: tools.length > 0 ? tools : undefined,
      bqConfig: input.bqConfig,
      workspaceId,
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

  // Extract sources with resolved table names
  const sources = parsed.sources.map((s) => ({
    name: s.name,
    alias: s.alias,
    table: s.pipe_file?.table ?? s.staging?.table ?? s.name,
    filters: s.filters ?? undefined,
  }));

  // Extract joins — coerce to flat strings since LLMs sometimes generate
  // structured objects for left/right instead of plain alias strings
  const coerceJoinRef = (val: unknown): string => {
    if (typeof val === "string") return val;
    if (val && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.source === "string") return obj.source;
      if (typeof obj.alias === "string") return obj.alias;
      if (typeof obj.name === "string") return obj.name;
    }
    return String(val ?? "");
  };
  const joins = parsed.joins
    ? (parsed.joins as Record<string, unknown>[]).map((j) => ({
        left: coerceJoinRef(j.left),
        right: coerceJoinRef(j.right),
        on: Array.isArray(j.on) ? j.on.map(String) : [],
        how: typeof j.how === "string" ? j.how : "left",
      }))
    : null;

  const structureType = parsed.concat ? "assembly" : "flat";

  const pipelineValues = {
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
  };

  if (existing) {
    // Atomic copy-on-write: mark old not-latest + insert new
    createPipelineVersion(existing.id, pipelineValues);
  } else {
    db.insert(entityPipeline).values(pipelineValues).run();
  }
}

const MAX_TOOL_ROUNDS = 5;

/**
 * Execute a generation with a tool loop: the LLM can call BQ, RAG, and
 * reference doc tools before producing its final output.
 * Returns the final text content (YAML or JSON) to be parsed as before.
 */
async function executeGenerationWithTools(
  prepared: PreparedGeneration,
): Promise<{ content: string; inputTokens: number; outputTokens: number; model: string }> {
  const { provider, model, systemMessage, userMessage, tools, bqConfig, workspaceId } = prepared;

  const messages: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }> = [{ role: "user", content: userMessage }];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalModel = model || "";
  const estimatedOutputTokens = Math.max(4096, prepared.targetFields.length * 200);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await provider.generateCompletion({
      systemMessage,
      messages,
      model,
      maxTokens: Math.min(estimatedOutputTokens, 16384),
      temperature: 0,
      tools,
    });

    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;
    finalModel = response.model;

    // No tool use — return the final text
    if (response.stopReason !== "tool_use" || !response.toolCalls?.length) {
      return {
        content: response.content,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        model: finalModel,
      };
    }

    // Build assistant content blocks (text + tool_use)
    const assistantBlocks: Array<Record<string, unknown>> = [];
    if (response.content) {
      assistantBlocks.push({ type: "text", text: response.content });
    }
    for (const tc of response.toolCalls) {
      assistantBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
    messages.push({ role: "assistant", content: assistantBlocks });

    // Execute each tool call
    const toolResultBlocks: Array<Record<string, unknown>> = [];
    for (const tc of response.toolCalls) {
      let resultContent: string;

      if (tc.name === "query_bigquery" && bqConfig) {
        const result = await executeBigQueryTool(
          tc.input as { sql: string; purpose: string },
          bqConfig,
        );
        resultContent = formatToolResultForLLM(result);
      } else if (tc.name === "search_source_schema" && workspaceId) {
        const result = executeSourceSchemaSearch(
          tc.input as unknown as SourceSchemaInput,
          workspaceId,
        );
        resultContent = formatSourceSchemaForLLM(result);
      } else if (tc.name === "get_reference_docs" && workspaceId) {
        const result = executeReferenceDocRetrieval(
          tc.input as unknown as ReferenceDocsInput,
          workspaceId,
        );
        resultContent = formatReferenceDocsForLLM(result);
      } else {
        resultContent = `Unknown tool: ${tc.name}`;
      }

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: resultContent,
      });
    }
    messages.push({ role: "user", content: toolResultBlocks });
  }

  // Max rounds exceeded — do one final call without tools to force output
  const finalResponse = await provider.generateCompletion({
    systemMessage,
    messages,
    model,
    maxTokens: Math.min(estimatedOutputTokens, 16384),
    temperature: 0,
    // No tools — force text output
  });

  totalInputTokens += finalResponse.inputTokens;
  totalOutputTokens += finalResponse.outputTokens;

  return {
    content: finalResponse.content,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    model: finalResponse.model,
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
    targetFieldMeta,
    sourceEntities,
    sourceFields,
    outputFormat,
  } = prepared;

  const startTime = Date.now();
  const estimatedOutputTokens = Math.max(4096, targetFields.length * 200);
  try {
    // Dispatch to tool loop if tools are configured, otherwise single-shot
    const response = prepared.tools?.length
      ? await executeGenerationWithTools(prepared)
      : await provider.generateCompletion({
          systemMessage,
          userMessage,
          model,
          maxTokens: Math.min(Math.max(4096, targetFields.length * 200), 16384),
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
