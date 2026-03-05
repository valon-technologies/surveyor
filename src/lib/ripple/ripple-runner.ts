import { db } from "@/lib/db";
import { fieldMapping, field, entity, generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { assembleContext } from "@/lib/generation/context-assembler";
import { buildRipplePrompt } from "@/lib/generation/ripple-prompt-builder";
import { parseGenerationOutput } from "@/lib/generation/output-parser";
import { resolveProvider, getTokenBudget } from "@/lib/generation/provider-resolver";
import { logActivity } from "@/lib/activity/log-activity";
import type { RippleProposal, MappingSnapshot } from "@/types/ripple";
import type { ConfidenceLevel, MappingType } from "@/lib/constants";

interface GenerateInput {
  workspaceId: string;
  userId: string;
  exemplarMappingId: string;
  targetMappingIds: string[];
  userInstruction?: string;
  preferredProvider?: "claude" | "openai";
}

interface GenerateResult {
  proposals: RippleProposal[];
  errors: Array<{ entityId: string; entityName: string; error: string }>;
}

/**
 * Compute edit diffs between exemplar and its parent version.
 */
function computeEditDiffs(
  exemplar: Record<string, unknown>,
  parent: Record<string, unknown> | null
): Array<{ field: string; before: string | null; after: string | null }> {
  if (!parent) return [];

  const diffFields = [
    "mappingType",
    "sourceEntityId",
    "sourceFieldId",
    "transform",
    "defaultValue",
    "reasoning",
    "confidence",
    "notes",
  ];

  const diffs: Array<{ field: string; before: string | null; after: string | null }> = [];

  for (const f of diffFields) {
    const before = parent[f] as string | null;
    const after = exemplar[f] as string | null;
    if (before !== after) {
      diffs.push({ field: f, before, after });
    }
  }

  return diffs;
}

/**
 * Build a MappingSnapshot from a mapping record.
 */
function toSnapshot(
  mapping: Record<string, unknown>,
  sourceEntityName: string | null,
  sourceFieldName: string | null
): MappingSnapshot {
  return {
    mappingType: (mapping.mappingType as MappingType) || null,
    sourceEntityName,
    sourceFieldName,
    sourceEntityId: (mapping.sourceEntityId as string) || null,
    sourceFieldId: (mapping.sourceFieldId as string) || null,
    transform: (mapping.transform as string) || null,
    defaultValue: (mapping.defaultValue as string) || null,
    enumMapping: (mapping.enumMapping as Record<string, string | null>) || null,
    reasoning: (mapping.reasoning as string) || null,
    confidence: (mapping.confidence as ConfidenceLevel) || null,
    notes: (mapping.notes as string) || null,
  };
}

/**
 * Resolve entity and field names from IDs.
 */
async function resolveNames(
  sourceEntityId: string | null,
  sourceFieldId: string | null
): Promise<{ sourceEntityName: string | null; sourceFieldName: string | null }> {
  let sourceEntityName: string | null = null;
  let sourceFieldName: string | null = null;

  if (sourceEntityId) {
    const [se] = await db.select().from(entity).where(eq(entity.id, sourceEntityId)).limit(1);
    sourceEntityName = se?.displayName || se?.name || null;
  }
  if (sourceFieldId) {
    const [sf] = await db.select().from(field).where(eq(field.id, sourceFieldId)).limit(1);
    sourceFieldName = sf?.displayName || sf?.name || null;
  }

  return { sourceEntityName, sourceFieldName };
}

/**
 * Generate ripple proposals without saving. Groups target mappings by entity
 * for efficient LLM calls.
 */
export async function generateRippleProposals(input: GenerateInput): Promise<GenerateResult> {
  const { workspaceId, userId, exemplarMappingId, targetMappingIds, userInstruction } = input;

  // Load exemplar
  const exemplarMapping = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, exemplarMappingId), eq(fieldMapping.workspaceId, workspaceId)))
    )[0];

  if (!exemplarMapping) {
    throw new Error("Exemplar mapping not found");
  }

  // Load exemplar's parent for edit diff
  const parentMapping = exemplarMapping.parentId
    ? (await db.select().from(fieldMapping).where(eq(fieldMapping.id, exemplarMapping.parentId)).limit(1))[0]
    : null;

  const editDiffs = computeEditDiffs(
    exemplarMapping as unknown as Record<string, unknown>,
    parentMapping as unknown as Record<string, unknown> | null
  );

  // Resolve exemplar names
  const [exemplarField] = await db.select().from(field).where(eq(field.id, exemplarMapping.targetFieldId)).limit(1);
  const exemplarEntity = exemplarField
    ? (await db.select().from(entity).where(eq(entity.id, exemplarField.entityId)).limit(1))[0]
    : null;
  const exemplarSourceNames = await resolveNames(exemplarMapping.sourceEntityId, exemplarMapping.sourceFieldId);

  const exemplarData = {
    targetFieldName: exemplarField?.displayName || exemplarField?.name || "unknown",
    entityName: exemplarEntity?.displayName || exemplarEntity?.name || "unknown",
    mappingType: exemplarMapping.mappingType,
    sourceEntityName: exemplarSourceNames.sourceEntityName,
    sourceFieldName: exemplarSourceNames.sourceFieldName,
    transform: exemplarMapping.transform,
    defaultValue: exemplarMapping.defaultValue,
    enumMapping: exemplarMapping.enumMapping,
    reasoning: exemplarMapping.reasoning,
    confidence: exemplarMapping.confidence,
    notes: exemplarMapping.notes,
  };

  // Load target mappings and group by entity
  const targetMappings = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.workspaceId, workspaceId), eq(fieldMapping.isLatest, true)))
    )
    .filter((m) => targetMappingIds.includes(m.id));

  // Group by entity
  const byEntity = new Map<string, typeof targetMappings>();
  for (const m of targetMappings) {
    const [targetF] = await db.select().from(field).where(eq(field.id, m.targetFieldId)).limit(1);
    if (!targetF) continue;

    const group = byEntity.get(targetF.entityId) || [];
    group.push(m);
    byEntity.set(targetF.entityId, group);
  }

  // Resolve provider
  const { provider, providerName } = await resolveProvider(userId, input.preferredProvider);
  const tokenBudget = getTokenBudget(providerName);

  // Load source entities and fields for output parsing
  const sourceEntities = await db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    ;

  const sourceEntityIds = sourceEntities.map((e) => e.id);
  const sourceFields = sourceEntityIds.length > 0
    ? (await db.select().from(field)).filter((f) => sourceEntityIds.includes(f.entityId))
    : [];

  const proposals: RippleProposal[] = [];
  const errors: GenerateResult["errors"] = [];

  // Process each entity group
  for (const [entityId, mappings] of byEntity) {
    const [targetEntity] = await db.select().from(entity).where(eq(entity.id, entityId)).limit(1);
    if (!targetEntity) continue;

    const entityName = targetEntity.displayName || targetEntity.name;

    try {
      // Load target fields for this group
      const targetFieldsDataRaw = await Promise.all(mappings.map(async (m) => {
        const [f] = await db.select().from(field).where(eq(field.id, m.targetFieldId)).limit(1);
        const srcNames = await resolveNames(m.sourceEntityId, m.sourceFieldId);
        return { mapping: m, field: f, sourceNames: srcNames };
      }));
      const targetFieldsData = targetFieldsDataRaw.filter((d) => d.field != null);

      // Assemble context
      const assembledCtx = await assembleContext(workspaceId, targetEntity.name, tokenBudget);

      // Build prompt
      const { systemMessage, userMessage } = buildRipplePrompt({
        entityName,
        entityDescription: targetEntity.description,
        exemplar: exemplarData,
        editDiffs,
        userInstruction: userInstruction || null,
        targetFields: targetFieldsData.map((d) => ({
          name: d.field!.name,
          dataType: d.field!.dataType,
          isRequired: d.field!.isRequired,
          isKey: d.field!.isKey,
          description: d.field!.description,
          enumValues: d.field!.enumValues,
          sampleValues: d.field!.sampleValues,
          currentMapping: {
            mappingType: d.mapping.mappingType,
            sourceEntityName: d.sourceNames.sourceEntityName,
            sourceFieldName: d.sourceNames.sourceFieldName,
            transform: d.mapping.transform,
            reasoning: d.mapping.reasoning,
          },
        })),
        assembledContext: assembledCtx,
      });

      // Create generation record
      const generationId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.insert(generation)
        .values({
          id: generationId,
          workspaceId,
          entityId,
          generationType: "field_mapping",
          status: "running",
          provider: providerName,
          promptSnapshot: {
            systemMessage,
            userMessage,
            skillsUsed: assembledCtx.skillsUsed.map((s) => s.name),
          },
          createdAt: now,
          updatedAt: now,
        })
        ;

      // Call LLM
      const startTime = Date.now();
      const estimatedOutputTokens = Math.max(4096, targetFieldsData.length * 200);

      const response = await provider.generateCompletion({
        systemMessage,
        userMessage,
        maxTokens: Math.min(estimatedOutputTokens, 16384),
        temperature: 0,
      });

      const durationMs = Date.now() - startTime;

      // Parse output
      const parsed = parseGenerationOutput(response.content, {
        targetFields: targetFieldsData.map((d) => ({
          id: d.field!.id,
          name: d.field!.name,
          entityId: d.field!.entityId,
        })),
        sourceEntities: sourceEntities.map((e) => ({ id: e.id, name: e.name })),
        sourceFields: sourceFields.map((f) => ({ id: f.id, name: f.name, entityId: f.entityId })),
        requestedFieldNames: targetFieldsData.map((d) => d.field!.name),
      });

      // Update generation record
      await db.update(generation)
        .set({
          status: "completed",
          model: response.model,
          output: response.content,
          outputParsed: parsed as unknown as Record<string, unknown>,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          durationMs,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(generation.id, generationId))
        ;

      // Build proposals from parsed output, dedup by target field
      const seenMappingIds = new Set<string>();
      for (const fm of parsed.fieldMappings) {
        const matchingData = targetFieldsData.find(
          (d) => d.field!.name.toLowerCase() === fm.targetFieldName.toLowerCase()
        );
        if (!matchingData) continue;

        // Skip duplicates — LLM may mention the same field multiple times
        if (seenMappingIds.has(matchingData.mapping.id)) continue;
        seenMappingIds.add(matchingData.mapping.id);

        const beforeSourceNames = await resolveNames(
          matchingData.mapping.sourceEntityId,
          matchingData.mapping.sourceFieldId
        );

        proposals.push({
          originalMappingId: matchingData.mapping.id,
          targetFieldId: matchingData.field!.id,
          targetFieldName: matchingData.field!.displayName || matchingData.field!.name,
          entityId,
          entityName,
          before: toSnapshot(
            matchingData.mapping as unknown as Record<string, unknown>,
            beforeSourceNames.sourceEntityName,
            beforeSourceNames.sourceFieldName
          ),
          after: {
            mappingType: fm.mappingType,
            sourceEntityName: fm.sourceEntityName,
            sourceFieldName: fm.sourceFieldName,
            sourceEntityId: fm.sourceEntityId,
            sourceFieldId: fm.sourceFieldId,
            transform: fm.transform,
            defaultValue: fm.defaultValue,
            enumMapping: fm.enumMapping,
            reasoning: fm.reasoning,
            confidence: fm.confidence,
            notes: fm.notes,
          },
          generationId,
        });
      }
    } catch (error) {
      errors.push({
        entityId,
        entityName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { proposals, errors };
}

/**
 * Apply approved ripple proposals by creating new mapping versions
 * via copy-on-write.
 */
export async function applyRippleProposals(
  workspaceId: string,
  userId: string,
  proposals: RippleProposal[],
  exemplarMappingId: string
): Promise<{ applied: number; mappingIds: string[] }> {
  const now = new Date().toISOString();
  const appliedIds: string[] = [];

  // Resolve exemplar field name for change summary
  const exemplarMapping = (await db
    .select()
    .from(fieldMapping)
    .where(eq(fieldMapping.id, exemplarMappingId))
    )[0];
  const exemplarField = exemplarMapping
    ? (await db.select().from(field).where(eq(field.id, exemplarMapping.targetFieldId)).limit(1))[0]
    : null;
  const exemplarFieldName = exemplarField?.displayName || exemplarField?.name || "unknown";

  for (const proposal of proposals) {
    // Verify the original mapping is still the latest version
    const currentMapping = (await db
      .select()
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.id, proposal.originalMappingId),
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true)
        )
      )
      )[0];

    if (!currentMapping) {
      // Skip — mapping was already updated by another operation
      continue;
    }

    // Mark old version as not latest
    await db.update(fieldMapping)
      .set({ isLatest: false, updatedAt: now })
      .where(eq(fieldMapping.id, proposal.originalMappingId))
      ;

    // Create new version
    const newId = crypto.randomUUID();
    await db.insert(fieldMapping)
      .values({
        id: newId,
        workspaceId,
        targetFieldId: proposal.targetFieldId,
        status: "pending",
        mappingType: proposal.after.mappingType,
        sourceEntityId: proposal.after.sourceEntityId,
        sourceFieldId: proposal.after.sourceFieldId,
        transform: proposal.after.transform,
        defaultValue: proposal.after.defaultValue,
        enumMapping: proposal.after.enumMapping,
        reasoning: proposal.after.reasoning,
        confidence: proposal.after.confidence,
        notes: proposal.after.notes,
        createdBy: "ripple",
        generationId: proposal.generationId,
        version: (currentMapping.version || 1) + 1,
        parentId: proposal.originalMappingId,
        isLatest: true,
        changeSummary: `Ripple from ${exemplarFieldName}`,
        createdAt: now,
        updatedAt: now,
      })
      ;

    appliedIds.push(newId);

    // Log activity
    logActivity({
      workspaceId,
      fieldMappingId: newId,
      entityId: proposal.entityId,
      actorId: userId,
      actorName: "user",
      action: "ripple_propagated",
      detail: {
        exemplarMappingId,
        exemplarFieldName,
        originalMappingId: proposal.originalMappingId,
      },
    });
  }

  return { applied: appliedIds.length, mappingIds: appliedIds };
}
