import { db } from "@/lib/db";
import {
  entity,
  field,
  fieldMapping,
  batchRun,
  chatSession,
  chatMessage,
  workspace,
  learning,
  entityPipeline,
  user,
  question,
} from "@/lib/db/schema";
import { eq, and, ne, or, isNull, desc } from "drizzle-orm";
import type { MappingStatus } from "@/lib/constants";
import { synthesizePipelineFromMappings } from "./pipeline-synthesizer";
import { extractAndPersistContextGaps } from "./context-gap-extractor";
import { assembleContext } from "./context-assembler";
import { buildChatPrompt, injectBaselineData, type SourceDataPreview } from "./chat-prompt-builder";
import { resolveProvider, getTokenBudget } from "./provider-resolver";
import type { ToolDefinition, ToolCall } from "@/lib/llm/provider";
import type { BigQueryConfig } from "@/types/workspace";
import {
  getBigQueryToolDefinition,
  executeBigQueryTool,
  formatToolResultForLLM,
} from "@/lib/bigquery/tool-executor";
import { runQuery } from "@/lib/bigquery/gestalt-client";
import { buildKey, getCached, setCached } from "@/lib/bigquery/prefetch-cache";
import { verifyAndCorrectPipeline } from "./pipeline-verifier";
import {
  getSourceSchemaToolDefinition,
  executeSourceSchemaSearch,
  formatSourceSchemaForLLM,
  getReferenceDocsToolDefinition,
  executeReferenceDocRetrieval,
  formatReferenceDocsForLLM,
  getSiblingMappingsToolDefinition,
  executeSiblingMappingLookup,
  formatSiblingMappingsForLLM,
  getMappingExamplesToolDefinition,
  executeMappingExampleSearch,
  formatMappingExamplesForLLM,
  type SourceSchemaInput,
  type ReferenceDocsInput,
  type SiblingMappingsInput,
  type MappingExamplesInput,
} from "@/lib/rag";

// ─── Constants ─────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_RESULT_CHARS = 32_000;
const KICKOFF_MESSAGE =
  `Please map this field. Start by checking sibling mappings to understand the established ` +
  `source pattern, then search for candidate source fields. Propose a mapping-update block ` +
  `with your recommendation. Be decisive — propose first, don't ask questions.`;

// ─── Types ─────────────────────────────────────────────────────

export interface BulkChatInput {
  workspaceId: string;
  userId: string;
  entityIds?: string[];
  includeStatuses?: MappingStatus[];
  preferredProvider?: "claude" | "openai";
  model?: string;
}

interface FieldTask {
  fieldId: string;
  fieldName: string;
  entityId: string;
  entityName: string;
  mappingId: string | null;
}

interface EntityBatch {
  entityId: string;
  entityName: string;
  fieldCount: number;
}

// ─── Batch Run Creation ────────────────────────────────────────

export function createBulkChatRun(input: BulkChatInput): {
  batchRunId: string;
  entities: EntityBatch[];
  totalFields: number;
} {
  const { workspaceId, userId, entityIds } = input;
  const DEFAULT_INCLUDE: MappingStatus[] = ["unmapped", "unreviewed", "punted", "needs_discussion", "excluded"];
  const includeStatuses = new Set(input.includeStatuses ?? DEFAULT_INCLUDE);

  // Find target entities
  let targetEntities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .orderBy(entity.sortOrder)
    .all();

  if (entityIds?.length) {
    const idSet = new Set(entityIds);
    targetEntities = targetEntities.filter((e) => idSet.has(e.id));
  }

  if (targetEntities.length === 0) {
    throw new Error("No target entities found");
  }

  // Build targetFieldId → current status map
  const fieldStatusMap = new Map<string, MappingStatus>();
  const existing = db
    .select({ targetFieldId: fieldMapping.targetFieldId, status: fieldMapping.status })
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true)
      )
    )
    .all();
  for (const m of existing) fieldStatusMap.set(m.targetFieldId, m.status as MappingStatus);

  // Count eligible fields per entity
  const entities: EntityBatch[] = [];
  let totalFields = 0;

  for (const e of targetEntities) {
    const fields = db
      .select()
      .from(field)
      .where(eq(field.entityId, e.id))
      .all();

    const eligible = fields.filter((f) => {
      const currentStatus = fieldStatusMap.get(f.id) ?? "unmapped";
      return includeStatuses.has(currentStatus);
    });

    if (eligible.length > 0) {
      entities.push({
        entityId: e.id,
        entityName: e.displayName || e.name,
        fieldCount: eligible.length,
      });
      totalFields += eligible.length;
    }
  }

  if (entities.length === 0) {
    throw new Error("No eligible fields found for the selected statuses");
  }

  // Create batch run record
  const batchRunId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(batchRun)
    .values({
      id: batchRunId,
      workspaceId,
      status: "pending",
      totalEntities: entities.length,
      completedEntities: 0,
      failedEntities: 0,
      totalFields,
      completedFields: 0,
      config: {
        provider: input.preferredProvider,
        model: input.model,
        includeStatuses: Array.from(includeStatuses),
      },
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { batchRunId, entities, totalFields };
}

// ─── Batch Run Execution ───────────────────────────────────────

export async function executeBulkChatRun(
  batchRunId: string,
  entities: EntityBatch[],
  input: BulkChatInput
): Promise<void> {
  const { workspaceId, userId } = input;
  const DEFAULT_INCLUDE: MappingStatus[] = ["unmapped", "unreviewed", "punted", "needs_discussion", "excluded"];
  const includeStatuses = new Set(input.includeStatuses ?? DEFAULT_INCLUDE);
  const now = () => new Date().toISOString();

  let completedEntities = 0;
  let failedEntities = 0;
  let completedFields = 0;

  // Resolve provider once for the whole run
  const { provider, providerName } = resolveProvider(
    userId,
    input.preferredProvider
  );

  // Load workspace settings for BQ config
  const ws = db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .get();
  const wsSettings = ws?.settings as Record<string, unknown> | null;
  const bqConfig = wsSettings?.bigquery as BigQueryConfig | undefined;

  try {
    db.update(batchRun)
      .set({ status: "running", startedAt: now(), updatedAt: now() })
      .where(eq(batchRun.id, batchRunId))
      .run();

    for (const batch of entities) {
      // Check for cancellation before each entity
      const currentRun = db.select({ status: batchRun.status }).from(batchRun).where(eq(batchRun.id, batchRunId)).get();
      if (currentRun?.status === "cancelled") {
        console.log(`[bulk-chat] Run ${batchRunId} cancelled, stopping after ${completedEntities} entities`);
        break;
      }

      let entityFieldsCompleted = 0;
      let entityFieldsFailed = 0;

      try {
        // Load eligible fields for this entity (re-query to reflect prior field completions)
        const fieldStatusMap = new Map<string, MappingStatus>();
        const latestMappingsForFilter = db
          .select({ targetFieldId: fieldMapping.targetFieldId, status: fieldMapping.status })
          .from(fieldMapping)
          .where(
            and(
              eq(fieldMapping.workspaceId, workspaceId),
              eq(fieldMapping.isLatest, true)
            )
          )
          .all();
        for (const m of latestMappingsForFilter) fieldStatusMap.set(m.targetFieldId, m.status as MappingStatus);

        const entityFields = db
          .select()
          .from(field)
          .where(eq(field.entityId, batch.entityId))
          .orderBy(field.sortOrder)
          .all()
          .filter((f) => {
            const currentStatus = fieldStatusMap.get(f.id) ?? "unmapped";
            return includeStatuses.has(currentStatus);
          });

        // Process each field in a fresh session
        for (const targetField of entityFields) {
          try {
            const success = await processField({
              workspaceId,
              userId,
              entityId: batch.entityId,
              entityName: batch.entityName,
              targetField,
              batchRunId,
              provider,
              providerName,
              model: input.model,
              bqConfig,
            });

            if (success) {
              entityFieldsCompleted++;
              completedFields++;
            } else {
              entityFieldsFailed++;
            }
          } catch (err) {
            console.warn(
              `[bulk-chat] Field "${targetField.name}" failed:`,
              err instanceof Error ? err.message : err
            );
            entityFieldsFailed++;
          }

          // Update progress after each field
          try {
            db.update(batchRun)
              .set({ completedFields, updatedAt: now() })
              .where(eq(batchRun.id, batchRunId))
              .run();
          } catch {
            // Non-critical
          }
        }

        if (entityFieldsFailed === entityFields.length) {
          failedEntities++;
        } else {
          completedEntities++;

          // Synthesize entity pipeline YAML from completed field mappings
          try {
            synthesizePipelineFromMappings({
              workspaceId,
              entityId: batch.entityId,
              entityName: batch.entityName,
              batchRunId,
            });

            // Post-entity SQL verification with auto-correction
            if (bqConfig) {
              try {
                const verifyResult = await verifyAndCorrectPipeline({
                  workspaceId,
                  entityId: batch.entityId,
                  entityName: batch.entityName,
                  bqConfig: { projectId: bqConfig.projectId, sourceDataset: bqConfig.sourceDataset },
                  batchRunId,
                  userId,
                });
                if (verifyResult.status !== "passed" && verifyResult.status !== "skipped") {
                  console.log(
                    `[bulk-chat] SQL verification for "${batch.entityName}": ${verifyResult.status}`,
                    verifyResult.correctedColumns || verifyResult.flaggedColumns || "",
                  );
                }
              } catch (valErr) {
                console.warn(
                  `[bulk-chat] SQL verification error for "${batch.entityName}":`,
                  valErr instanceof Error ? valErr.message : valErr
                );
              }
            }
          } catch (pipelineErr) {
            console.warn(
              `[bulk-chat] Pipeline synthesis failed for "${batch.entityName}":`,
              pipelineErr instanceof Error ? pipelineErr.message : pipelineErr
            );
          }
        }
      } catch (err) {
        console.warn(
          `[bulk-chat] Entity "${batch.entityName}" failed:`,
          err instanceof Error ? err.message : err
        );
        failedEntities++;
      }

      // Update entity progress
      try {
        db.update(batchRun)
          .set({
            completedEntities,
            failedEntities,
            completedFields,
            updatedAt: now(),
          })
          .where(eq(batchRun.id, batchRunId))
          .run();
      } catch {
        // Non-critical
      }
    }

    // Mark as completed (preserve "cancelled" status if set)
    const finalCheck = db.select({ status: batchRun.status }).from(batchRun).where(eq(batchRun.id, batchRunId)).get();
    const finalStatus = finalCheck?.status === "cancelled"
      ? "cancelled"
      : failedEntities === entities.length ? "failed" : "completed";

    db.update(batchRun)
      .set({
        status: finalStatus,
        completedEntities,
        failedEntities,
        completedFields,
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(batchRun.id, batchRunId))
      .run();
  } catch (error) {
    console.error("[bulk-chat] Fatal error:", error);
    try {
      db.update(batchRun)
        .set({
          status: "failed",
          completedEntities,
          failedEntities,
          completedFields,
          completedAt: now(),
          updatedAt: now(),
        })
        .where(eq(batchRun.id, batchRunId))
        .run();
    } catch {
      console.error("[bulk-chat] Failed to mark batch run as failed:", batchRunId);
    }
  }
}

// ─── Per-Field Processing ──────────────────────────────────────

interface ProcessFieldInput {
  workspaceId: string;
  userId: string;
  entityId: string;
  entityName: string;
  targetField: typeof field.$inferSelect;
  batchRunId: string;
  provider: ReturnType<typeof resolveProvider>["provider"];
  providerName: string;
  model?: string;
  bqConfig?: BigQueryConfig;
}

async function processField(input: ProcessFieldInput): Promise<boolean> {
  const {
    workspaceId,
    userId,
    entityId,
    entityName,
    targetField,
    batchRunId,
    provider,
    providerName,
    model,
    bqConfig,
  } = input;

  // ── 1. Load context for this field ───────────────────────────

  const targetEntity = db
    .select()
    .from(entity)
    .where(eq(entity.id, entityId))
    .get();
  if (!targetEntity) return false;

  // Current mapping (if any)
  const mapping = db
    .select()
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.targetFieldId, targetField.id),
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true)
      )
    )
    .get();

  // Resolve source names for current mapping
  let sourceEntityName: string | null = null;
  let sourceFieldName: string | null = null;
  if (mapping?.sourceEntityId) {
    const se = db
      .select()
      .from(entity)
      .where(eq(entity.id, mapping.sourceEntityId))
      .get();
    sourceEntityName = se?.displayName || se?.name || null;
  }
  if (mapping?.sourceFieldId) {
    const sf = db
      .select()
      .from(field)
      .where(eq(field.id, mapping.sourceFieldId))
      .get();
    sourceFieldName = sf?.displayName || sf?.name || null;
  }

  // Source schema stats
  const sourceEntities = db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();

  let totalSourceFields = 0;
  for (const se of sourceEntities) {
    totalSourceFields += db
      .select({ name: field.name })
      .from(field)
      .where(eq(field.entityId, se.id))
      .all().length;
  }

  // Sibling fields (fresh from DB — reflects prior field mappings)
  const siblingTargetFields = db
    .select()
    .from(field)
    .where(eq(field.entityId, entityId))
    .orderBy(field.sortOrder)
    .all()
    .filter((f) => f.id !== targetField.id);

  const latestMappings = db
    .select()
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true)
      )
    )
    .all();

  const siblingFields = siblingTargetFields.map((sf) => {
    const m = latestMappings.find((sm) => sm.targetFieldId === sf.id);
    let sourceInfo: string | null = null;
    if (m?.sourceEntityId) {
      const se = sourceEntities.find((e) => e.id === m.sourceEntityId);
      let sfName: string | null = null;
      if (m.sourceFieldId) {
        const sfld = db
          .select({ name: field.name })
          .from(field)
          .where(eq(field.id, m.sourceFieldId))
          .get();
        sfName = sfld?.name || null;
      }
      sourceInfo = se
        ? `${se.displayName || se.name}${sfName ? "." + sfName : ""}`
        : null;
    }
    return {
      name: sf.displayName || sf.name,
      dataType: sf.dataType,
      mappingStatus: m ? `${m.status} (${m.confidence || "unknown"})` : "unmapped",
      sourceInfo,
      mappingType: m?.mappingType ?? null,
      transform: m?.transform ?? null,
      reasoning: m?.reasoning ?? null,
      confidence: m?.confidence ?? null,
    };
  });

  // Derive primary source + schema stats
  const sourceCounts = new Map<string, number>();
  for (const sf of siblingFields) {
    if (sf.sourceInfo) {
      const table = sf.sourceInfo.split(".")[0];
      sourceCounts.set(table, (sourceCounts.get(table) || 0) + 1);
    }
  }
  let primarySource: string | undefined;
  let maxCount = 0;
  for (const [table, count] of sourceCounts) {
    if (count > maxCount) {
      primarySource = table;
      maxCount = count;
    }
  }

  // ── Pre-flight BQ data enrichment ──────────────────────────────
  // Run 1-2 targeted BQ queries per field to pre-load data awareness
  let preflightBaseline: SourceDataPreview | null = null;
  let baselineDataPreloaded = false;

  if (bqConfig && primarySource) {
    const { projectId, sourceDataset } = bqConfig;
    const BQ_TIMEOUT = 3000; // 3-second timeout per query

    // Derive candidate source column name from target field
    // Try exact match, then camelCase variant
    const candidateCol = targetField.name;
    const camelCol = targetField.name
      .split("_")
      .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join("");

    try {
      const promises: Promise<void>[] = [];
      let nullRateResult: { rows?: Record<string, unknown>[] } | null = null;
      let distinctResult: { rows?: Record<string, unknown>[] } | null = null;

      // Check cache first
      const nullKey = buildKey(projectId, sourceDataset, primarySource, "nullrate", camelCol);
      const distinctKey = buildKey(projectId, sourceDataset, primarySource, "distinct", camelCol);
      const cachedNull = getCached(nullKey);
      const cachedDistinct = getCached(distinctKey);

      // Query 1: Null rate + distinct count on the candidate column
      if (!cachedNull) {
        const nullSql = `SELECT COUNT(*) as total, COUNT(${camelCol}) as non_null, COUNT(DISTINCT ${camelCol}) as distinct_vals FROM \`${projectId}.${sourceDataset}.${primarySource}\` LIMIT 1`;
        promises.push(
          Promise.race([
            runQuery(projectId, nullSql, 1)
              .then((data) => {
                nullRateResult = data as { rows?: Record<string, unknown>[] };
                setCached(nullKey, data);
              }),
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), BQ_TIMEOUT)),
          ]).catch(() => { /* skip on failure */ })
        );
      } else {
        nullRateResult = cachedNull.data as { rows?: Record<string, unknown>[] } | null;
      }

      // Query 2: For enum target fields, get distinct values with counts
      const isEnumField = targetField.enumValues && targetField.enumValues.length > 0;
      if (isEnumField) {
        if (!cachedDistinct) {
          const distinctSql = `SELECT ${camelCol}, COUNT(*) as cnt FROM \`${projectId}.${sourceDataset}.${primarySource}\` WHERE ${camelCol} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25`;
          promises.push(
            Promise.race([
              runQuery(projectId, distinctSql, 25)
                .then((data) => {
                  distinctResult = data as { rows?: Record<string, unknown>[] };
                  setCached(distinctKey, data);
                }),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), BQ_TIMEOUT)),
            ]).catch(() => { /* skip on failure */ })
          );
        } else {
          distinctResult = cachedDistinct.data as { rows?: Record<string, unknown>[] } | null;
        }
      }

      await Promise.allSettled(promises);

      // Assemble pre-flight data
      if (nullRateResult?.rows?.[0] || distinctResult?.rows) {
        const row = nullRateResult?.rows?.[0];
        preflightBaseline = {
          tableName: primarySource,
          rowCount: row ? Number(row.total ?? 0) : 0,
          sampleRows: [], // Don't duplicate sample rows
          fieldProfile: {
            fieldName: camelCol,
            totalRows: row ? Number(row.total ?? 0) : undefined,
            nullCount: row ? Number(row.total ?? 0) - Number(row.non_null ?? 0) : undefined,
            distinctValues: distinctResult?.rows?.map((r) => r[camelCol] ?? r.val) ?? undefined,
          },
        };
        baselineDataPreloaded = true;
      }
    } catch {
      // Pre-flight is best-effort — continue without it
    }
  }

  // Entity learnings
  const structuredLearnings = db
    .select({ content: learning.content, fieldName: learning.fieldName, scope: learning.scope })
    .from(learning)
    .where(
      and(
        eq(learning.workspaceId, workspaceId),
        or(eq(learning.entityId, entityId), eq(learning.scope, "workspace"))
      )
    )
    .orderBy(desc(learning.createdAt))
    .limit(10)
    .all();

  const entityLearnings: { fieldName: string; correction: string }[] = [];
  const crossEntityLearnings: {
    entityName: string;
    entityDescription: string | null;
    fieldName: string;
    correction: string;
  }[] = [];

  for (const sl of structuredLearnings) {
    if (sl.scope === "field" && sl.fieldName) {
      entityLearnings.push({ fieldName: sl.fieldName, correction: sl.content });
    } else if (sl.scope === "entity" || sl.scope === "workspace") {
      crossEntityLearnings.push({
        entityName: sl.scope === "workspace" ? "Workspace-wide" : entityName,
        entityDescription: null,
        fieldName: "(entity-level insight)",
        correction: sl.content,
      });
    }
  }

  // Load workspace-scoped rules for prompt injection
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

  // Entity pipeline structure
  let entityStructure:
    | {
        structureType: "flat" | "assembly";
        sources: { name: string; alias: string; table: string }[];
        joins?: { left: string; right: string; on: string[]; how: string }[] | null;
        hasConcat: boolean;
      }
    | undefined;

  const pipeline = db
    .select()
    .from(entityPipeline)
    .where(
      and(eq(entityPipeline.entityId, entityId), eq(entityPipeline.isLatest, true))
    )
    .get();

  const unmatchedPipelineSources: string[] = [];

  if (pipeline) {
    const pipelineSources = (pipeline.sources as { name: string; alias: string; table: string }[]) || [];
    entityStructure = {
      structureType: pipeline.structureType as "flat" | "assembly",
      sources: pipelineSources,
      joins: pipeline.joins as
        | { left: string; right: string; on: string[]; how: string }[]
        | null,
      hasConcat: !!pipeline.concat,
    };

    // Track pipeline sources that don't match any source entity
    for (const ps of pipelineSources) {
      const match = sourceEntities.find(
        (e) =>
          e.name === ps.table ||
          e.name === ps.name ||
          (e.displayName && (e.displayName === ps.table || e.displayName === ps.name))
      );
      if (!match) unmatchedPipelineSources.push(ps.table);
    }
  }

  // Assemble context (RAG mode — metadata only)
  const assembledCtx = assembleContext(workspaceId, targetEntity.name, 0);

  // Answered questions for this field/entity — prevents re-flagging resolved gaps
  const answeredQs = db
    .select({
      question: question.question,
      answer: question.answer,
      fieldName: field.name,
    })
    .from(question)
    .leftJoin(field, eq(question.fieldId, field.id))
    .where(
      and(
        eq(question.workspaceId, workspaceId),
        eq(question.entityId, entityId),
        eq(question.status, "resolved")
      )
    )
    .all()
    .filter((q) => q.answer)
    .map((q) => ({ question: q.question, answer: q.answer!, fieldName: q.fieldName }));

  // ── 2. Build prompt ──────────────────────────────────────────

  const { systemMessage, contextMessage } = buildChatPrompt({
    entityName: targetEntity.displayName || targetEntity.name,
    entityDescription: targetEntity.description,
    targetField: {
      name: targetField.displayName || targetField.name,
      dataType: targetField.dataType,
      isRequired: targetField.isRequired,
      isKey: targetField.isKey,
      description: targetField.description,
      enumValues: targetField.enumValues,
    },
    currentMapping: mapping
      ? {
          mappingType: mapping.mappingType,
          sourceEntityName,
          sourceFieldName,
          transform: mapping.transform,
          defaultValue: mapping.defaultValue,
          enumMapping: mapping.enumMapping,
          reasoning: mapping.reasoning,
          confidence: mapping.confidence,
          notes: mapping.notes,
        }
      : null,
    assembledContext: assembledCtx,
    priorDiscussionSummary: undefined,
    entityLearnings: entityLearnings.length > 0 ? entityLearnings : undefined,
    crossEntityLearnings: crossEntityLearnings.length > 0 ? crossEntityLearnings : undefined,
    siblingFields,
    bigqueryAvailable: !!bqConfig,
    bigqueryDataset: bqConfig
      ? `${bqConfig.projectId}.${bqConfig.sourceDataset}`
      : undefined,
    baselineDataPreloaded,
    entityStructure,
    pipelineYamlSpec: pipeline?.yamlSpec ?? undefined,
    ragEnabled: true,
    sourceSchemaStats: {
      tableCount: sourceEntities.length,
      fieldCount: totalSourceFields,
      primarySource,
    },
    unmatchedPipelineSources: unmatchedPipelineSources.length > 0 ? unmatchedPipelineSources : undefined,
    answeredQuestions: answeredQs.length > 0 ? answeredQs : undefined,
    workspaceRules: workspaceRules.length > 0 ? workspaceRules : undefined,
    workspaceId,
  });

  // Inject pre-flight baseline data into context message if available
  let finalContextMessage = contextMessage;
  if (preflightBaseline && baselineDataPreloaded) {
    finalContextMessage = injectBaselineData(contextMessage, preflightBaseline);
  }

  // ── 3. Create chat session ───────────────────────────────────

  const sessionId = crypto.randomUUID();
  const sessionNow = new Date().toISOString();

  // Find or create a fieldMapping record for this field
  let fieldMappingId = mapping?.id || null;
  if (!fieldMappingId) {
    // Create a placeholder mapping so the session has something to link to
    fieldMappingId = crypto.randomUUID();
    db.insert(fieldMapping)
      .values({
        id: fieldMappingId,
        workspaceId,
        targetFieldId: targetField.id,
        status: "unmapped",
        createdBy: "llm",
        assigneeId: userId,
        batchRunId,
        version: 1,
        isLatest: true,
        createdAt: sessionNow,
        updatedAt: sessionNow,
      })
      .run();
  }

  db.insert(chatSession)
    .values({
      id: sessionId,
      workspaceId,
      fieldMappingId,
      targetFieldId: targetField.id,
      entityId,
      status: "active",
      messageCount: 1,
      lastMessageAt: sessionNow,
      createdBy: userId,
      createdAt: sessionNow,
      updatedAt: sessionNow,
    })
    .run();

  // Save system message
  const fullSystemMessage = systemMessage + "\n\n" + finalContextMessage;
  db.insert(chatMessage)
    .values({
      sessionId,
      role: "system",
      content: fullSystemMessage,
      createdAt: sessionNow,
    })
    .run();

  // ── 4. Run chat with tools ───────────────────────────────────

  // Build tools
  const tools: ToolDefinition[] = [
    getSourceSchemaToolDefinition(),
    getReferenceDocsToolDefinition(),
    getSiblingMappingsToolDefinition(),
    getMappingExamplesToolDefinition(),
  ];
  if (bqConfig) {
    tools.push(getBigQueryToolDefinition(bqConfig));
  }

  // Save kickoff user message
  db.insert(chatMessage)
    .values({
      sessionId,
      role: "user",
      content: KICKOFF_MESSAGE,
      metadata: {},
      createdAt: new Date().toISOString(),
    })
    .run();

  // Run the LLM tool loop
  const messages: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }> = [{ role: "user", content: KICKOFF_MESSAGE }];

  let fullContent = "";
  let mappingUpdate: Record<string, unknown> | null = null;
  let toolResultBudget = MAX_TOOL_RESULT_CHARS;
  let toolRound = 0;
  let activeTools = tools;

  while (toolRound <= MAX_TOOL_ROUNDS) {
    toolRound++;

    let stopReason: "end_turn" | "tool_use" | "max_tokens" | undefined;
    const pendingToolCalls: ToolCall[] = [];
    const assistantContentBlocks: Array<Record<string, unknown>> = [];
    let roundText = "";

    const chunks = provider.generateStream({
      systemMessage: fullSystemMessage,
      messages,
      temperature: 0.3,
      maxTokens: 4096,
      model,
      ...(activeTools.length > 0 ? { tools: activeTools } : {}),
    });

    for await (const chunk of chunks) {
      if (chunk.type === "text" && chunk.content) {
        roundText += chunk.content;
        fullContent += chunk.content;

        // Check for mapping-update
        const updateMatch = fullContent.match(
          /```mapping-update\s*\n([\s\S]*?)\n\s*```/
        );
        if (updateMatch && !mappingUpdate) {
          try {
            mappingUpdate = JSON.parse(updateMatch[1]) as Record<string, unknown>;
          } catch {
            // Not complete yet
          }
        }
      }
      if (chunk.type === "tool_use" && chunk.toolCall) {
        pendingToolCalls.push(chunk.toolCall);
      }
      if (chunk.type === "stop" && chunk.stopReason) {
        stopReason = chunk.stopReason;
      }
    }

    // No tool use — we're done
    if (stopReason !== "tool_use" || pendingToolCalls.length === 0) {
      break;
    }

    // Build assistant content blocks
    if (roundText) {
      assistantContentBlocks.push({ type: "text", text: roundText });
    }
    for (const tc of pendingToolCalls) {
      assistantContentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
    messages.push({ role: "assistant", content: assistantContentBlocks });

    // Execute tools
    const toolResultBlocks: Array<Record<string, unknown>> = [];

    for (const tc of pendingToolCalls) {
      let llmContent: string;

      if (tc.name === "search_source_schema") {
        const result = executeSourceSchemaSearch(
          tc.input as unknown as SourceSchemaInput,
          workspaceId
        );
        llmContent = formatSourceSchemaForLLM(result);
      } else if (tc.name === "get_reference_docs") {
        const result = executeReferenceDocRetrieval(
          tc.input as unknown as ReferenceDocsInput,
          workspaceId
        );
        llmContent = formatReferenceDocsForLLM(result);
      } else if (tc.name === "get_sibling_mappings") {
        const result = executeSiblingMappingLookup(
          tc.input as unknown as SiblingMappingsInput,
          workspaceId,
          entityId,
          targetField.id
        );
        llmContent = formatSiblingMappingsForLLM(result);
      } else if (tc.name === "get_mapping_examples") {
        const result = executeMappingExampleSearch(
          tc.input as unknown as MappingExamplesInput,
          workspaceId,
          entityId
        );
        llmContent = formatMappingExamplesForLLM(result);
      } else if (tc.name === "query_bigquery" && bqConfig) {
        const result = await executeBigQueryTool(
          tc.input as { sql: string; purpose: string },
          bqConfig
        );
        llmContent = formatToolResultForLLM(result);
      } else {
        llmContent = `Unknown tool: ${tc.name}`;
      }

      toolResultBudget -= llmContent.length;
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: llmContent,
      });
    }

    messages.push({ role: "user", content: toolResultBlocks });

    // Check budget
    if (toolResultBudget <= 0) {
      messages.push({
        role: "user",
        content:
          "Tool result budget exceeded. Please propose your mapping now based on what you've gathered.",
      });
      activeTools = [];
    }
  }

  // ── 5. Save results ──────────────────────────────────────────

  const msgNow = new Date().toISOString();

  // Save assistant message
  db.insert(chatMessage)
    .values({
      sessionId,
      role: "assistant",
      content: fullContent,
      metadata: {
        provider: providerName,
        mappingUpdate: mappingUpdate || undefined,
      },
      createdAt: msgNow,
    })
    .run();

  // Extract and persist CONTEXT GAP flags
  extractAndPersistContextGaps(fullContent, {
    workspaceId,
    entityId,
    fieldId: targetField.id,
    fieldMappingId,
    chatSessionId: sessionId,
  });

  // Update session
  db.update(chatSession)
    .set({
      messageCount: 3, // system + user kickoff + assistant response
      lastMessageAt: msgNow,
      status: "resolved",
      updatedAt: msgNow,
    })
    .where(eq(chatSession.id, sessionId))
    .run();

  // Apply mapping update if one was proposed
  if (mappingUpdate) {
    // Resolve source entity/field names to IDs
    const enriched = resolveMappingNames(mappingUpdate, workspaceId);

    db.update(fieldMapping)
      .set({
        status: enriched.status as string || "unreviewed",
        mappingType: enriched.mappingType as string || null,
        sourceEntityId: enriched.sourceEntityId as string || null,
        sourceFieldId: enriched.sourceFieldId as string || null,
        transform: enriched.transform as string || null,
        defaultValue: enriched.defaultValue as string || null,
        enumMapping: enriched.enumMapping as Record<string, string> || null,
        reasoning: enriched.reasoning as string || null,
        confidence: enriched.confidence as string || null,
        notes: enriched.notes as string || null,
        createdBy: "llm",
        assigneeId: userId,
        batchRunId,
        updatedAt: msgNow,
      })
      .where(eq(fieldMapping.id, fieldMappingId!))
      .run();

    return true;
  }

  return false;
}

// ─── Helpers ───────────────────────────────────────────────────

function matchName(a: string, b: string): boolean {
  return (
    a.toLowerCase().replace(/[_\s-]/g, "") ===
    b.toLowerCase().replace(/[_\s-]/g, "")
  );
}

function resolveMappingNames(
  update: Record<string, unknown>,
  workspaceId: string
): Record<string, unknown> {
  const enriched = { ...update };
  const entityName = update.sourceEntityName as string | undefined;
  const fieldName = update.sourceFieldName as string | undefined;

  if (!entityName && !fieldName) return enriched;

  const sourceEntities = db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();

  let resolvedEntityId: string | null = null;
  if (entityName) {
    const match = sourceEntities.find(
      (e) => matchName(e.name, entityName) || matchName(e.displayName || "", entityName)
    );
    if (match) {
      resolvedEntityId = match.id;
      enriched.sourceEntityId = match.id;
    }
  }

  if (fieldName) {
    const candidates = resolvedEntityId
      ? db
          .select({ id: field.id, name: field.name, entityId: field.entityId })
          .from(field)
          .where(eq(field.entityId, resolvedEntityId))
          .all()
      : db
          .select({ id: field.id, name: field.name, entityId: field.entityId })
          .from(field)
          .all()
          .filter((f) => sourceEntities.some((e) => e.id === f.entityId));

    const match = candidates.find((f) => matchName(f.name, fieldName));
    if (match) {
      enriched.sourceFieldId = match.id;
      if (!resolvedEntityId) enriched.sourceEntityId = match.entityId;
    }
  }

  return enriched;
}
