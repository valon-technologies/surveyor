import { db } from "@/lib/db";
import { entity, field, fieldMapping, batchRun, generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { startGeneration, executeGeneration } from "./runner";
import type { ParseResult } from "@/types/generation";

interface BatchRunInput {
  workspaceId: string;
  userId: string;
  preferredProvider?: "claude" | "openai";
  model?: string;
  skipAlreadyMapped?: boolean;
}

interface EntityBatch {
  entityId: string;
  entityName: string;
  fieldCount: number;
}

/**
 * Create a batch run record and return it. Does NOT start processing.
 */
export async function createBatchRun(input: BatchRunInput): Promise<{
  batchRunId: string;
  entities: EntityBatch[];
  totalFields: number;
}> {
  const { workspaceId, userId, skipAlreadyMapped = true } = input;

  // Find all target entities
  const targetEntities = await db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .orderBy(entity.sortOrder);

  if (targetEntities.length === 0) {
    throw new Error("No target entities found in workspace");
  }

  // Get mapped field IDs if skipping already mapped
  const mappedFieldIds = new Set<string>();
  if (skipAlreadyMapped) {
    const existing = await db
      .select({ targetFieldId: fieldMapping.targetFieldId })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true)
        )
      );
    for (const m of existing) mappedFieldIds.add(m.targetFieldId);
  }

  // Count unmapped fields per entity
  const entities: EntityBatch[] = [];
  let totalFields = 0;

  for (const e of targetEntities) {
    const fields = await db
      .select()
      .from(field)
      .where(eq(field.entityId, e.id));

    const unmappedFields = skipAlreadyMapped
      ? fields.filter((f) => !mappedFieldIds.has(f.id))
      : fields;

    if (unmappedFields.length > 0) {
      entities.push({
        entityId: e.id,
        entityName: e.displayName || e.name,
        fieldCount: unmappedFields.length,
      });
      totalFields += unmappedFields.length;
    }
  }

  if (entities.length === 0) {
    throw new Error("All fields are already mapped");
  }

  // Create batch run record
  const batchRunId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(batchRun)
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
        skipAlreadyMapped,
      },
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

  return { batchRunId, entities, totalFields };
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

  // Mark as running
  await db.update(batchRun)
    .set({ status: "running", startedAt: now(), updatedAt: now() })
    .where(eq(batchRun.id, batchRunId));

  let completedEntities = 0;
  let failedEntities = 0;
  let completedFields = 0;

  for (const batch of entities) {
    try {
      // Use existing generation infrastructure
      const { prepared } = await startGeneration({
        workspaceId,
        userId,
        entityId: batch.entityId,
        generationType: "field_mapping",
        preferredProvider,
        model,
      });

      // Link generation to batch run
      await db.update(generation)
        .set({ batchRunId })
        .where(eq(generation.id, prepared.generationId));

      // Execute LLM call
      await executeGeneration(prepared);

      // Read the completed generation
      const gen = (await db
        .select()
        .from(generation)
        .where(eq(generation.id, prepared.generationId)))[0];

      if (gen?.status === "completed" && gen.outputParsed) {
        const parsed = gen.outputParsed as unknown as ParseResult;

        // Auto-save field mappings
        for (const fm of parsed.fieldMappings) {
          if (!fm.targetFieldId) continue;

          await db.insert(fieldMapping)
            .values({
              workspaceId,
              targetFieldId: fm.targetFieldId,
              status: fm.status,
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
              generationId: prepared.generationId,
              batchRunId,
              version: 1,
              isLatest: true,
            });
        }

        completedFields += parsed.fieldMappings.length;
        completedEntities++;
      } else {
        failedEntities++;
      }
    } catch {
      failedEntities++;
    }

    // Update progress after each entity
    await db.update(batchRun)
      .set({
        completedEntities,
        failedEntities,
        completedFields,
        updatedAt: now(),
      })
      .where(eq(batchRun.id, batchRunId));
  }

  // Mark as completed
  await db.update(batchRun)
    .set({
      status: failedEntities === entities.length ? "failed" : "completed",
      completedEntities,
      failedEntities,
      completedFields,
      completedAt: now(),
      updatedAt: now(),
    })
    .where(eq(batchRun.id, batchRunId));
}
