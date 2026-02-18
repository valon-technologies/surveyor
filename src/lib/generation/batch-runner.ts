import { db } from "@/lib/db";
import { entity, field, fieldMapping, batchRun, generation, question } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { startGeneration, executeGeneration, persistEntityPipeline } from "./runner";
import { classifyStructure, generateAssemblyYaml, scopeSourceSchema } from "./structure-classifier";
import { resolveProvider } from "./provider-resolver";
import { issueToQuestion, type ValidationIssue } from "./yaml-validator";
import { parseYamlOutput, type YamlParseResult } from "./output-parser";
import type { ParseResult, ParsedFieldMapping } from "@/types/generation";
import type { MappingStatus } from "@/lib/constants";

interface BatchRunInput {
  workspaceId: string;
  userId: string;
  preferredProvider?: "claude" | "openai";
  model?: string;
  includeStatuses?: MappingStatus[];
  outputFormat?: "json" | "yaml";
  enableStructureClassification?: boolean;
  entityIds?: string[];
}

interface EntityBatch {
  entityId: string;
  entityName: string;
  fieldCount: number;
}

/** Triage mapping status based on confidence level */
function triageStatus(fm: ParsedFieldMapping): MappingStatus {
  if (fm.status === "unmapped") return "unmapped";
  if (fm.confidence === "low") return "needs_discussion";
  return "unreviewed"; // medium and high
}

/**
 * Create a batch run record and return it. Does NOT start processing.
 */
export function createBatchRun(input: BatchRunInput): {
  batchRunId: string;
  entities: EntityBatch[];
  totalFields: number;
} {
  const { workspaceId, userId } = input;
  const DEFAULT_INCLUDE: MappingStatus[] = ["unmapped", "unreviewed", "punted", "needs_discussion", "excluded"];
  const includeStatuses = new Set(input.includeStatuses ?? DEFAULT_INCLUDE);

  // Find all target entities
  const targetEntities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .orderBy(entity.sortOrder)
    .all();

  if (targetEntities.length === 0) {
    throw new Error("No target entities found in workspace");
  }

  // Filter to specific entities if entityIds provided
  const filteredEntities = input.entityIds?.length
    ? targetEntities.filter((e) => input.entityIds!.includes(e.id))
    : targetEntities;

  if (filteredEntities.length === 0) {
    throw new Error("No matching target entities found for the selected IDs");
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

  for (const e of filteredEntities) {
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
    }).run();

  return { batchRunId, entities, totalFields };
}

/**
 * Generate mappings for a single flat entity and save results.
 * Returns the number of fields completed, or throws on failure.
 */
async function generateFlatEntity(
  batch: EntityBatch,
  workspaceId: string,
  userId: string,
  batchRunId: string,
  outputFormat: "json" | "yaml",
  preferredProvider?: "claude" | "openai",
  model?: string,
): Promise<{ fieldsCompleted: number }> {
  const { prepared } = startGeneration({
    workspaceId,
    userId,
    entityId: batch.entityId,
    generationType: "field_mapping",
    preferredProvider,
    model,
    outputFormat,
  });

  // Link generation to batch run
  db.update(generation)
    .set({ batchRunId })
    .where(eq(generation.id, prepared.generationId))
    .run();

  // Execute LLM call (includes validation + correction loop for YAML)
  await executeGeneration(prepared);

  // Read the completed generation
  const gen = db
    .select()
    .from(generation)
    .where(eq(generation.id, prepared.generationId))
    .get();

  if (!gen || gen.status !== "completed" || !gen.outputParsed) {
    throw new Error(`Generation ${prepared.generationId} failed or produced no output`);
  }

  const parsed = gen.outputParsed as unknown as ParseResult;

  // Save mappings and create questions
  const { questionsCreated, mappingLookup, fieldsWithExplicitQuestion } = saveMappingsAndQuestions(
    parsed,
    batch,
    workspaceId,
    prepared.generationId,
    batchRunId,
  );

  // Create questions from validation issues (YAML path)
  if (outputFormat === "yaml") {
    const validationQuestions = createValidationQuestions(
      gen.validationIssues as unknown as ValidationIssue[] | null,
      batch,
      workspaceId,
      mappingLookup,
      fieldsWithExplicitQuestion,
    );

    if (validationQuestions > 0) {
      console.log(`[batch] Created ${validationQuestions} validation questions for "${batch.entityName}"`);
    }

    // Persist entity pipeline
    try {
      const yamlResult = gen.outputParsed as unknown as YamlParseResult;
      if (yamlResult.yamlParsed) {
        persistEntityPipeline({
          workspaceId,
          entityId: batch.entityId,
          yamlResult,
          generationId: prepared.generationId,
          batchRunId,
        });
      }
    } catch (pipelineErr) {
      console.warn(`[batch] Failed to persist pipeline for "${batch.entityName}":`, pipelineErr);
    }
  }

  if (questionsCreated > 0) {
    console.log(`[batch] Created ${questionsCreated} questions for "${batch.entityName}"`);
  }

  return { fieldsCompleted: parsed.fieldMappings.length };
}

/**
 * Generate mappings for an assembly entity using two-pass component generation.
 * 1. Generate each component separately with scoped source schema
 * 2. Generate assembly YAML mechanically (no LLM)
 */
async function generateAssemblyEntity(
  batch: EntityBatch,
  components: { name: string; description: string; sourceFieldPattern: string | null; filter: string | null }[],
  sourceSchema: { entityName: string; fields: { name: string; dataType: string | null }[] }[],
  workspaceId: string,
  userId: string,
  batchRunId: string,
  preferredProvider?: "claude" | "openai",
  model?: string,
): Promise<{ fieldsCompleted: number }> {
  let totalFields = 0;

  // Load target field names for assembly generation
  const targetFields = db
    .select()
    .from(field)
    .where(eq(field.entityId, batch.entityId))
    .orderBy(field.sortOrder)
    .all();
  const targetColumnNames = targetFields.map((f) => f.name);

  // Generate each component
  for (const comp of components) {
    try {
      // Find or create a component entity record
      const compEntityName = comp.name;
      let compEntity = db
        .select()
        .from(entity)
        .where(and(eq(entity.workspaceId, workspaceId), eq(entity.name, compEntityName)))
        .get();

      if (!compEntity) {
        // Find the parent entity to get its schemaAssetId
        const parentEntity = db
          .select()
          .from(entity)
          .where(eq(entity.id, batch.entityId))
          .get();

        if (!parentEntity) {
          console.warn(`[batch] Parent entity ${batch.entityId} not found, skipping component "${comp.name}"`);
          continue;
        }

        // Create component entity
        const compEntityId = crypto.randomUUID();
        const nowTs = new Date().toISOString();
        db.insert(entity)
          .values({
            id: compEntityId,
            workspaceId,
            schemaAssetId: parentEntity.schemaAssetId,
            name: compEntityName,
            displayName: comp.description,
            side: "target",
            description: `Component of ${batch.entityName}: ${comp.description}`,
            parentEntityId: batch.entityId,
            createdAt: nowTs,
            updatedAt: nowTs,
          })
          .run();

        // Copy target fields to component entity
        for (const tf of targetFields) {
          db.insert(field)
            .values({
              entityId: compEntityId,
              name: tf.name,
              dataType: tf.dataType,
              isRequired: tf.isRequired,
              isKey: tf.isKey,
              description: tf.description,
              enumValues: tf.enumValues,
              sampleValues: tf.sampleValues,
              sortOrder: tf.sortOrder,
            })
            .run();
        }

        compEntity = db.select().from(entity).where(eq(entity.id, compEntityId)).get()!;
      }

      // Scope source schema for this component
      const scopedSchema = scopeSourceSchema(sourceSchema, comp, components);

      console.log(
        `[batch] Generating component "${comp.name}" with ${scopedSchema.reduce((n, s) => n + s.fields.length, 0)} scoped source fields`,
      );

      // Generate the component using existing infrastructure
      const result = await generateFlatEntity(
        { entityId: compEntity.id, entityName: compEntityName, fieldCount: targetFields.length },
        workspaceId,
        userId,
        batchRunId,
        "yaml",
        preferredProvider,
        model,
      );
      totalFields += result.fieldsCompleted;
    } catch (compErr) {
      console.warn(`[batch] Component "${comp.name}" generation failed:`, compErr);
    }
  }

  // Generate assembly YAML mechanically
  try {
    const assemblyYamlStr = generateAssemblyYaml(
      batch.entityName,
      components.map((c) => ({
        name: c.name,
        alias: c.name.split("_").pop() || c.name,
      })),
      targetColumnNames,
    );

    // Parse the assembly YAML and persist it
    const resolutionCtx = {
      targetFields: targetFields.map((f) => ({ id: f.id, name: f.name, entityId: f.entityId })),
      sourceEntities: components.map((c) => ({ id: c.name, name: c.name })),
      sourceFields: [],
      requestedFieldNames: targetColumnNames,
    };
    const assemblyParsed = parseYamlOutput(assemblyYamlStr, resolutionCtx);

    if (assemblyParsed.yamlParsed) {
      persistEntityPipeline({
        workspaceId,
        entityId: batch.entityId,
        yamlResult: assemblyParsed,
        generationId: batchRunId, // No individual generation for assembly
        batchRunId,
      });
      console.log(`[batch] Persisted assembly pipeline for "${batch.entityName}"`);
    }
  } catch (assemblyErr) {
    console.warn(`[batch] Assembly pipeline generation failed for "${batch.entityName}":`, assemblyErr);
  }

  return { fieldsCompleted: totalFields };
}

/**
 * Save field mappings and LLM-generated questions from a parsed generation result.
 * Returns the lookup map and fields that already have questions.
 */
function saveMappingsAndQuestions(
  parsed: ParseResult,
  batch: EntityBatch,
  workspaceId: string,
  generationId: string,
  batchRunId: string,
): {
  questionsCreated: number;
  mappingLookup: Map<string, { mappingId: string; targetFieldId: string; confidence: string | null; reviewComment: string | null; uncertaintyType: string | null }>;
  fieldsWithExplicitQuestion: Set<string>;
} {
  const mappingLookup = new Map<string, {
    mappingId: string;
    targetFieldId: string;
    confidence: string | null;
    reviewComment: string | null;
    uncertaintyType: string | null;
  }>();

  // Auto-save field mappings with explicit UUIDs and confidence-based triage
  for (const fm of parsed.fieldMappings) {
    if (!fm.targetFieldId) continue;

    const mappingId = crypto.randomUUID();
    const status = triageStatus(fm);

    db.insert(fieldMapping)
      .values({
        id: mappingId,
        workspaceId,
        targetFieldId: fm.targetFieldId,
        status,
        mappingType: fm.mappingType,
        sourceEntityId: fm.sourceEntityId,
        sourceFieldId: fm.sourceFieldId,
        transform: fm.transform,
        defaultValue: fm.defaultValue,
        enumMapping: fm.enumMapping,
        reasoning: fm.reasoning,
        confidence: fm.confidence,
        notes: fm.notes,
        createdBy: "llm",
        generationId,
        batchRunId,
        version: 1,
        isLatest: true,
      }).run();

    mappingLookup.set(
      fm.targetFieldName.toLowerCase(),
      {
        mappingId,
        targetFieldId: fm.targetFieldId,
        confidence: fm.confidence,
        reviewComment: fm.reviewComment,
        uncertaintyType: fm.uncertaintyType,
      },
    );
  }

  // Auto-create question records
  let questionsCreated = 0;
  const fieldsWithExplicitQuestion = new Set<string>();

  // 1. From parsed.questions (LLM-generated)
  if (parsed.questions?.length) {
    for (const pq of parsed.questions) {
      const lookup = pq.targetFieldName
        ? mappingLookup.get(pq.targetFieldName.toLowerCase())
        : null;

      if (pq.targetFieldName) {
        fieldsWithExplicitQuestion.add(pq.targetFieldName.toLowerCase());
      }

      try {
        db.insert(question).values({
          workspaceId,
          entityId: batch.entityId,
          fieldId: pq.targetFieldId ?? lookup?.targetFieldId ?? null,
          question: pq.questionText,
          status: "open",
          askedBy: "llm",
          priority: pq.priority,
          targetForTeam: "SM",
          fieldMappingId: lookup?.mappingId ?? null,
        }).run();
        questionsCreated++;
      } catch (qErr) {
        console.warn(`[batch] Failed to create question for "${pq.targetFieldName}":`, qErr);
      }
    }
  }

  // 2. Gap-fill: auto-create questions for medium/low confidence mappings
  //    that don't already have an explicit question
  for (const [fieldName, info] of mappingLookup) {
    if (fieldsWithExplicitQuestion.has(fieldName)) continue;

    const shouldCreate =
      (info.confidence === "low") ||
      (info.confidence === "medium" && info.reviewComment);

    if (shouldCreate && info.reviewComment) {
      const priority = info.confidence === "low" ? "high" : "normal";
      try {
        db.insert(question).values({
          workspaceId,
          entityId: batch.entityId,
          fieldId: info.targetFieldId,
          question: info.reviewComment,
          status: "open",
          askedBy: "llm",
          priority,
          targetForTeam: "SM",
          fieldMappingId: info.mappingId,
        }).run();
        questionsCreated++;
      } catch {
        // Non-critical — continue
      }
    }
  }

  return { questionsCreated, mappingLookup, fieldsWithExplicitQuestion };
}

/**
 * Create question records from unresolved validation issues.
 */
function createValidationQuestions(
  validationIssues: ValidationIssue[] | null,
  batch: EntityBatch,
  workspaceId: string,
  mappingLookup: Map<string, { mappingId: string; targetFieldId: string; confidence: string | null; reviewComment: string | null; uncertaintyType: string | null }>,
  fieldsWithExplicitQuestion: Set<string>,
): number {
  if (!validationIssues?.length) return 0;

  let questionsCreated = 0;
  const unresolvedErrors = validationIssues.filter((i) => i.severity === "error");

  for (const issue of unresolvedErrors) {
    const fieldKey = issue.field.toLowerCase();
    if (fieldsWithExplicitQuestion.has(fieldKey)) continue;
    fieldsWithExplicitQuestion.add(fieldKey);

    const lookup = mappingLookup.get(fieldKey);
    const questionText = issueToQuestion(issue);

    try {
      db.insert(question).values({
        workspaceId,
        entityId: batch.entityId,
        fieldId: lookup?.targetFieldId ?? null,
        question: questionText,
        status: "open",
        askedBy: "validator",
        priority: "high",
        targetForTeam: "SM",
        fieldMappingId: lookup?.mappingId ?? null,
      }).run();
      questionsCreated++;
    } catch {
      // Non-critical — continue
    }
  }

  return questionsCreated;
}

/**
 * Execute a batch run: process entities sequentially, generate mappings,
 * and auto-save results as fieldMapping records.
 * Designed to be called fire-and-forget.
 */
export async function executeBatchRun(
  batchRunId: string,
  entities: EntityBatch[],
  input: BatchRunInput
): Promise<void> {
  const { workspaceId, userId, preferredProvider, model } = input;
  const now = () => new Date().toISOString();

  let completedEntities = 0;
  let failedEntities = 0;
  let completedFields = 0;

  try {
    // Mark as running
    db.update(batchRun)
      .set({ status: "running", startedAt: now(), updatedAt: now() })
      .where(eq(batchRun.id, batchRunId))
      .run();

    const outputFormat = input.outputFormat ?? "json";
    const enableClassification = input.enableStructureClassification ?? (outputFormat === "yaml");

    for (const batch of entities) {
      try {
        // Report which entity is currently being processed
        try {
          db.update(batchRun)
            .set({ currentEntityName: batch.entityName, updatedAt: now() })
            .where(eq(batchRun.id, batchRunId))
            .run();
        } catch {
          // Non-critical — continue processing
        }

        // Structure classification + two-pass assembly flow
        if (enableClassification && outputFormat === "yaml") {
          try {
            const { provider } = resolveProvider(userId, preferredProvider);
            const sourceEntities = db
              .select()
              .from(entity)
              .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
              .all();

            const sourceFields = db
              .select()
              .from(field)
              .all()
              .filter((f) => sourceEntities.some((e) => e.id === f.entityId));

            const sourceSchema = sourceEntities.map((se) => ({
              entityName: se.name,
              fields: sourceFields
                .filter((sf) => sf.entityId === se.id)
                .map((sf) => ({ name: sf.name, dataType: sf.dataType })),
            }));

            const classification = await classifyStructure(
              batch.entityName,
              null,
              batch.fieldCount,
              sourceSchema,
              provider,
              model,
            );

            if (classification.type === "assembly" && classification.components?.length) {
              console.log(
                `[batch] Entity "${batch.entityName}" classified as assembly with components:`,
                classification.components.map((c) => c.name),
              );

              // Two-pass assembly generation
              const result = await generateAssemblyEntity(
                batch,
                classification.components,
                sourceSchema,
                workspaceId,
                userId,
                batchRunId,
                preferredProvider,
                model,
              );
              completedFields += result.fieldsCompleted;
              completedEntities++;
              continue; // Skip flat generation below
            }
          } catch (classifyErr) {
            console.warn(
              `[batch] Structure classification failed for "${batch.entityName}", proceeding with flat generation:`,
              classifyErr,
            );
          }
        }

        // Flat entity generation (default path)
        const result = await generateFlatEntity(
          batch,
          workspaceId,
          userId,
          batchRunId,
          outputFormat,
          preferredProvider,
          model,
        );
        completedFields += result.fieldsCompleted;
        completedEntities++;
      } catch {
        failedEntities++;
      }

      // Update progress after each entity
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
        // Progress update failed, continue processing
      }
    }

    // Mark as completed
    db.update(batchRun)
      .set({
        status: failedEntities === entities.length ? "failed" : "completed",
        completedEntities,
        failedEntities,
        completedFields,
        currentEntityName: null,
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(batchRun.id, batchRunId))
      .run();
  } catch (error) {
    // Ensure batch run is always marked as failed on unexpected errors
    try {
      db.update(batchRun)
        .set({
          status: "failed",
          completedEntities,
          failedEntities,
          completedFields,
          currentEntityName: null,
          completedAt: now(),
          updatedAt: now(),
        })
        .where(eq(batchRun.id, batchRunId))
        .run();
    } catch {
      // Last resort: can't even update the DB
      console.error("Failed to mark batch run as failed:", batchRunId, error);
    }
  }
}
