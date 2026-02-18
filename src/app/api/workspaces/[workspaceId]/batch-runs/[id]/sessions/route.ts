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
    return NextResponse.json({ sessions: [], batchRun: run });
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

  return NextResponse.json({ sessions: result, batchRun: run });
});
