import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db, withTransaction } from "@/lib/db";
import {
  chatSession,
  chatMessage,
  fieldMapping,
  field,
  entity,
  workspace,
  user,
  learning,
  entityPipeline,
  question,
} from "@/lib/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { assembleContext } from "@/lib/generation/context-assembler";
import { buildEntityChatPrompt } from "@/lib/generation/entity-chat-prompt-builder";
import { getTokenBudget } from "@/lib/generation/provider-resolver";

const createSessionSchema = z.object({
  entityId: z.string().min(1),
});

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const { searchParams } = new URL(req.url);
  const filterEntityId = searchParams.get("entityId");

  const conditions = [
    eq(chatSession.workspaceId, workspaceId),
    isNull(chatSession.fieldMappingId), // entity-level sessions have no fieldMappingId
  ];
  if (filterEntityId) {
    conditions.push(eq(chatSession.entityId, filterEntityId));
  }

  const sessions = db
    .select({
      id: chatSession.id,
      workspaceId: chatSession.workspaceId,
      fieldMappingId: chatSession.fieldMappingId,
      targetFieldId: chatSession.targetFieldId,
      entityId: chatSession.entityId,
      status: chatSession.status,
      messageCount: chatSession.messageCount,
      lastMessageAt: chatSession.lastMessageAt,
      createdBy: chatSession.createdBy,
      createdAt: chatSession.createdAt,
      updatedAt: chatSession.updatedAt,
      createdByName: user.name,
    })
    .from(chatSession)
    .leftJoin(user, eq(chatSession.createdBy, user.id))
    .where(and(...conditions))
    .orderBy(desc(chatSession.createdAt))
    .all();

  return NextResponse.json(sessions);
});

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { entityId } = parsed.data;

    // Load entity
    const targetEntity = db
      .select()
      .from(entity)
      .where(
        and(eq(entity.id, entityId), eq(entity.workspaceId, workspaceId))
      )
      .get();

    if (!targetEntity) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404 }
      );
    }

    // Load all target fields and their latest mappings
    const targetFields = db
      .select()
      .from(field)
      .where(eq(field.entityId, entityId))
      .orderBy(field.sortOrder)
      .all();

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

    // Load source entities for name resolution
    const sourceEntities = db
      .select()
      .from(entity)
      .where(
        and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source"))
      )
      .all();

    // Build field summaries
    const fields = targetFields.map((tf) => {
      const m = latestMappings.find((lm) => lm.targetFieldId === tf.id);
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
        name: tf.displayName || tf.name,
        dataType: tf.dataType,
        isRequired: tf.isRequired,
        mappingStatus: m
          ? `${m.status} (${m.confidence || "unknown"})`
          : "unmapped",
        mappingType: m?.mappingType ?? null,
        sourceInfo,
        transform: m?.transform ?? null,
        confidence: m?.confidence ?? null,
      };
    });

    // Detect RAG mode
    const wsForRag = db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .get();
    const wsSettings = wsForRag?.settings as Record<string, unknown> | null;
    const ragEnabled = wsSettings?.ragMode !== false;

    // Source schema stats (RAG mode)
    let sourceSchemaStats:
      | { tableCount: number; fieldCount: number; primarySource?: string }
      | undefined;

    if (ragEnabled) {
      let totalFields = 0;
      for (const se of sourceEntities) {
        const count = db
          .select({ name: field.name })
          .from(field)
          .where(eq(field.entityId, se.id))
          .all().length;
        totalFields += count;
      }
      sourceSchemaStats = {
        tableCount: sourceEntities.length,
        fieldCount: totalFields,
      };
      // Derive primary source from field mappings
      const sourceCounts = new Map<string, number>();
      for (const f of fields) {
        if (f.sourceInfo) {
          const table = f.sourceInfo.split(".")[0];
          sourceCounts.set(table, (sourceCounts.get(table) || 0) + 1);
        }
      }
      let primarySource = "";
      let maxCount = 0;
      for (const [table, count] of sourceCounts) {
        if (count > maxCount) {
          primarySource = table;
          maxCount = count;
        }
      }
      if (primarySource) sourceSchemaStats.primarySource = primarySource;
    }

    // Entity pipeline
    let entityStructure:
      | {
          structureType: "flat" | "assembly";
          sources: { name: string; alias: string; table: string }[];
          joins?:
            | { left: string; right: string; on: string[]; how: string }[]
            | null;
          hasConcat: boolean;
        }
      | undefined;

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

    if (pipeline) {
      const sources =
        (pipeline.sources as {
          name: string;
          alias: string;
          table: string;
        }[]) || [];
      entityStructure = {
        structureType: pipeline.structureType as "flat" | "assembly",
        sources,
        joins: pipeline.joins as
          | { left: string; right: string; on: string[]; how: string }[]
          | null,
        hasConcat: !!pipeline.concat,
      };
    }

    // Entity learnings
    const entityLearnings = db
      .select({
        content: learning.content,
        fieldName: learning.fieldName,
      })
      .from(learning)
      .where(
        and(
          eq(learning.workspaceId, workspaceId),
          eq(learning.entityId, entityId)
        )
      )
      .orderBy(desc(learning.createdAt))
      .limit(15)
      .all()
      .filter((l) => l.fieldName)
      .map((l) => ({
        fieldName: l.fieldName!,
        correction: l.content,
      }));

    // Answered questions
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
      .map((q) => ({
        question: q.question,
        answer: q.answer!,
        fieldName: q.fieldName,
      }));

    // BigQuery config
    let bqConfig:
      | { projectId: string; sourceDataset: string }
      | undefined;
    try {
      const ws = db
        .select({ settings: workspace.settings })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .get();
      bqConfig = (ws?.settings as Record<string, unknown> | null)
        ?.bigquery as typeof bqConfig;
    } catch {
      // Non-critical
    }

    // Assemble context
    const tokenBudget = getTokenBudget("claude");
    const assembledCtx = assembleContext(
      workspaceId,
      targetEntity.name,
      ragEnabled ? 0 : tokenBudget
    );

    const { systemMessage, contextMessage } = buildEntityChatPrompt({
      entityName: targetEntity.displayName || targetEntity.name,
      entityDescription: targetEntity.description,
      fields,
      assembledContext: assembledCtx,
      entityStructure,
      pipelineYamlSpec: pipeline?.yamlSpec ?? undefined,
      entityLearnings: entityLearnings.length > 0 ? entityLearnings : undefined,
      answeredQuestions: answeredQs.length > 0 ? answeredQs : undefined,
      bigqueryAvailable: !!bqConfig,
      bigqueryDataset: bqConfig
        ? `${bqConfig.projectId}.${bqConfig.sourceDataset}`
        : undefined,
      ragEnabled,
      sourceSchemaStats,
    });

    // Create session + initial system message atomically
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const session = withTransaction(() => {
      db.insert(chatSession)
        .values({
          id: sessionId,
          workspaceId,
          fieldMappingId: null,
          targetFieldId: null,
          entityId,
          status: "active",
          messageCount: 1,
          lastMessageAt: now,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.insert(chatMessage)
        .values({
          sessionId,
          role: "system",
          content: systemMessage + "\n\n" + contextMessage,
          createdAt: now,
        })
        .run();

      return db
        .select()
        .from(chatSession)
        .where(eq(chatSession.id, sessionId))
        .get();
    });

    return NextResponse.json(session);
  },
  { requiredRole: "editor" }
);
