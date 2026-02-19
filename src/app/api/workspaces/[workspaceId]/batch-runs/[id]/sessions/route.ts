import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import {
  batchRun,
  chatSession,
  chatMessage,
  fieldMapping,
  field,
  entity,
  generation,
} from "@/lib/db/schema";
import { eq, and, ne, gte, inArray } from "drizzle-orm";

/**
 * GET /api/workspaces/[workspaceId]/batch-runs/[id]/sessions
 *
 * Returns all chat sessions created during a batch run, with their messages.
 * Correlation: chatSession.fieldMappingId → fieldMapping.batchRunId
 */
export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const id = params.id;

  // 1. Verify batch run exists and belongs to workspace
  const run = db
    .select()
    .from(batchRun)
    .where(and(eq(batchRun.id, id), eq(batchRun.workspaceId, workspaceId)))
    .get();

  if (!run) {
    return NextResponse.json({ error: "Batch run not found" }, { status: 404 });
  }

  // 2. Find all field mappings created by this batch run
  const mappings = db
    .select({
      id: fieldMapping.id,
      targetFieldId: fieldMapping.targetFieldId,
      mappingType: fieldMapping.mappingType,
      sourceFieldId: fieldMapping.sourceFieldId,
      confidence: fieldMapping.confidence,
      status: fieldMapping.status,
    })
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.batchRunId, id),
        eq(fieldMapping.workspaceId, workspaceId)
      )
    )
    .all();

  if (mappings.length === 0) {
    return NextResponse.json({
      sessions: [],
      entityResults: [],
      mode: "single-shot" as const,
      batchRun: run,
    });
  }

  const mappingIds = mappings.map((m) => m.id);
  const mappingById = new Map(mappings.map((m) => [m.id, m]));

  // 3. Fetch sessions linked to these mappings
  const sessions = db
    .select({
      id: chatSession.id,
      fieldMappingId: chatSession.fieldMappingId,
      targetFieldId: chatSession.targetFieldId,
      entityId: chatSession.entityId,
      status: chatSession.status,
      messageCount: chatSession.messageCount,
      createdAt: chatSession.createdAt,
      updatedAt: chatSession.updatedAt,
      fieldName: field.name,
      entityName: entity.name,
    })
    .from(chatSession)
    .leftJoin(field, eq(chatSession.targetFieldId, field.id))
    .leftJoin(entity, eq(chatSession.entityId, entity.id))
    .where(
      and(
        eq(chatSession.workspaceId, workspaceId),
        inArray(chatSession.fieldMappingId, mappingIds),
        // Only include sessions created during/after the batch run
        ...(run.startedAt
          ? [gte(chatSession.createdAt, run.startedAt)]
          : [])
      )
    )
    .orderBy(chatSession.createdAt)
    .all();

  // If we have chat sessions, return chat mode
  if (sessions.length > 0) {
    // 4. Batch-fetch all messages for these sessions (excluding system role)
    const sessionIds = sessions.map((s) => s.id);
    const allMessages =
      sessionIds.length > 0
        ? db
            .select()
            .from(chatMessage)
            .where(
              and(
                inArray(chatMessage.sessionId, sessionIds),
                ne(chatMessage.role, "system")
              )
            )
            .orderBy(chatMessage.createdAt)
            .all()
        : [];

    // Group messages by session
    const messagesBySession = new Map<string, typeof allMessages>();
    for (const msg of allMessages) {
      const list = messagesBySession.get(msg.sessionId) || [];
      list.push(msg);
      messagesBySession.set(msg.sessionId, list);
    }

    // 5. Build response
    const result = sessions.map((s) => {
      const msgs = messagesBySession.get(s.id) || [];
      const mapping = s.fieldMappingId
        ? mappingById.get(s.fieldMappingId)
        : null;

      // Extract mapping result from last assistant message's metadata
      const lastAssistant = [...msgs]
        .reverse()
        .find((m) => m.role === "assistant" && m.metadata?.mappingUpdate);

      return {
        id: s.id,
        fieldMappingId: s.fieldMappingId,
        fieldName: s.fieldName,
        entityName: s.entityName,
        status: s.status,
        messageCount: s.messageCount,
        createdAt: s.createdAt,
        messages: msgs.filter(
          (m) => !(m.metadata as Record<string, unknown> | null)?.kickoff
        ),
        mappingResult: lastAssistant?.metadata?.mappingUpdate || null,
        mappingSummary: mapping
          ? {
              mappingType: mapping.mappingType,
              confidence: mapping.confidence,
              status: mapping.status,
            }
          : null,
      };
    });

    return NextResponse.json({
      sessions: result,
      entityResults: [],
      mode: "chat" as const,
      batchRun: run,
    });
  }

  // 6. Single-shot mode fallback: query generation records for this batch run
  const generations = db
    .select({
      id: generation.id,
      entityId: generation.entityId,
      entityName: entity.name,
      status: generation.status,
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
      durationMs: generation.durationMs,
      validationScore: generation.validationScore,
      error: generation.error,
    })
    .from(generation)
    .leftJoin(entity, eq(generation.entityId, entity.id))
    .where(eq(generation.batchRunId, id))
    .orderBy(generation.createdAt)
    .all();

  // 7. For each generation, gather field mappings with source info
  const batchMappings = db
    .select({
      id: fieldMapping.id,
      generationId: fieldMapping.generationId,
      targetFieldName: field.name,
      mappingType: fieldMapping.mappingType,
      confidence: fieldMapping.confidence,
      sourceFieldId: fieldMapping.sourceFieldId,
      sourceEntityId: fieldMapping.sourceEntityId,
      transform: fieldMapping.transform,
      reasoning: fieldMapping.reasoning,
    })
    .from(fieldMapping)
    .leftJoin(field, eq(fieldMapping.targetFieldId, field.id))
    .where(
      and(
        eq(fieldMapping.batchRunId, id),
        eq(fieldMapping.isLatest, true)
      )
    )
    .orderBy(field.name)
    .all();

  // Batch-lookup source field and entity names
  const sourceFieldIds = [...new Set(batchMappings.map((m) => m.sourceFieldId).filter(Boolean))] as string[];
  const sourceEntityIds = [...new Set(batchMappings.map((m) => m.sourceEntityId).filter(Boolean))] as string[];

  const sourceFieldNames = sourceFieldIds.length > 0
    ? new Map(
        db.select({ id: field.id, name: field.name })
          .from(field)
          .where(inArray(field.id, sourceFieldIds))
          .all()
          .map((f) => [f.id, f.name])
      )
    : new Map<string, string>();

  const sourceEntityNames = sourceEntityIds.length > 0
    ? new Map(
        db.select({ id: entity.id, name: entity.name })
          .from(entity)
          .where(inArray(entity.id, sourceEntityIds))
          .all()
          .map((e) => [e.id, e.name])
      )
    : new Map<string, string>();

  // Group mappings by generationId
  const mappingsByGeneration = new Map<string, typeof batchMappings>();
  for (const m of batchMappings) {
    if (!m.generationId) continue;
    const list = mappingsByGeneration.get(m.generationId) || [];
    list.push(m);
    mappingsByGeneration.set(m.generationId, list);
  }

  // 8. Assemble entity results
  const entityResults = generations.map((gen) => {
    const genMappings = mappingsByGeneration.get(gen.id) || [];
    return {
      entityId: gen.entityId || "",
      entityName: gen.entityName || "Unknown",
      generationId: gen.id,
      status: gen.status,
      fieldCount: genMappings.length,
      fieldMappings: genMappings.map((m) => ({
        targetFieldName: m.targetFieldName || "Unknown",
        mappingType: m.mappingType,
        confidence: m.confidence,
        sourceFieldName: m.sourceFieldId ? sourceFieldNames.get(m.sourceFieldId) || null : null,
        sourceEntityName: m.sourceEntityId ? sourceEntityNames.get(m.sourceEntityId) || null : null,
        transform: m.transform,
        reasoning: m.reasoning,
      })),
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      durationMs: gen.durationMs,
      validationScore: gen.validationScore,
      error: gen.error,
    };
  });

  return NextResponse.json({
    sessions: [],
    entityResults,
    mode: "single-shot" as const,
    batchRun: run,
  });
});
