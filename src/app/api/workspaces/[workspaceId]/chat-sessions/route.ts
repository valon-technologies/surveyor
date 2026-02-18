import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
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
import { eq, and, ne, or, isNull, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { assembleContext } from "@/lib/generation/context-assembler";
import { buildChatPrompt } from "@/lib/generation/chat-prompt-builder";
import { getTokenBudget } from "@/lib/generation/provider-resolver";
import type { BigQueryConfig } from "@/types/workspace";
import { runBaselinePrefetch } from "@/lib/bigquery/prefetch-runner";

const createSessionSchema = z.object({
  fieldMappingId: z.string().min(1),
});

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const { searchParams } = new URL(req.url);
  const filterMappingId = searchParams.get("fieldMappingId");

  const conditions = [eq(chatSession.workspaceId, workspaceId)];
  if (filterMappingId) {
    conditions.push(eq(chatSession.fieldMappingId, filterMappingId));
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

    const { fieldMappingId } = parsed.data;

    // Load mapping
    const mapping = db
      .select()
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.id, fieldMappingId),
          eq(fieldMapping.workspaceId, workspaceId)
        )
      ).get();

    if (!mapping) {
      return NextResponse.json(
        { error: "Mapping not found" },
        { status: 404 }
      );
    }

    // Load target field and entity
    const targetField = db
      .select()
      .from(field)
      .where(eq(field.id, mapping.targetFieldId))
      .get();

    if (!targetField) {
      return NextResponse.json(
        { error: "Target field not found" },
        { status: 404 }
      );
    }

    const targetEntity = db
      .select()
      .from(entity)
      .where(eq(entity.id, targetField.entityId))
      .get();

    if (!targetEntity) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404 }
      );
    }

    // Resolve source names
    let sourceEntityName: string | null = null;
    let sourceFieldName: string | null = null;
    if (mapping.sourceEntityId) {
      const se = db
        .select()
        .from(entity)
        .where(eq(entity.id, mapping.sourceEntityId))
        .get();
      sourceEntityName = se?.displayName || se?.name || null;
    }
    if (mapping.sourceFieldId) {
      const sf = db
        .select()
        .from(field)
        .where(eq(field.id, mapping.sourceFieldId))
        .get();
      sourceFieldName = sf?.displayName || sf?.name || null;
    }

    // Detect RAG mode from workspace settings (default: ON)
    const wsForRag = db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .get();
    const wsSettings = wsForRag?.settings as Record<string, unknown> | null;
    const ragEnabled = wsSettings?.ragMode !== false;

    // Load source schema catalog — full load in legacy mode, stats-only in RAG mode
    const sourceEntities = db
      .select()
      .from(entity)
      .where(
        and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source"))
      )
      .all();

    let sourceSchema: { entityName: string; fields: { name: string; dataType: string | null; description: string | null }[] }[] | undefined;
    let sourceSchemaStats: { tableCount: number; fieldCount: number; primarySource?: string } | undefined;

    if (ragEnabled) {
      // RAG mode: compute stats only
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
    } else {
      // Legacy mode: full schema load
      sourceSchema = sourceEntities.map((se) => {
        const fields = db
          .select({ name: field.name, dataType: field.dataType, description: field.description })
          .from(field)
          .where(eq(field.entityId, se.id))
          .orderBy(field.sortOrder)
          .all();
        return {
          entityName: se.displayName || se.name,
          fields,
        };
      });
    }

    // Load sibling target fields + their latest mapping state
    const siblingTargetFields = db
      .select()
      .from(field)
      .where(eq(field.entityId, targetEntity.id))
      .orderBy(field.sortOrder)
      .all()
      .filter((f) => f.id !== targetField.id);

    const siblingMappings = db
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
      const m = siblingMappings.find((sm) => sm.targetFieldId === sf.id);
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
        mappingStatus: m
          ? `${m.status} (${m.confidence || "unknown"})`
          : "unmapped",
        sourceInfo,
        mappingType: m?.mappingType ?? null,
        transform: m?.transform ?? null,
        reasoning: m?.reasoning ?? null,
        confidence: m?.confidence ?? null,
      };
    });

    // Fire background prefetch for BQ baseline data (non-blocking)
    let bqConfigForPrefetch: BigQueryConfig | undefined;
    if (sourceEntityName) {
      try {
        const ws = db
          .select({ settings: workspace.settings })
          .from(workspace)
          .where(eq(workspace.id, workspaceId))
          .get();
        bqConfigForPrefetch = (ws?.settings as Record<string, unknown> | null)?.bigquery as BigQueryConfig | undefined;

        if (bqConfigForPrefetch) {
          runBaselinePrefetch({
            bqConfig: bqConfigForPrefetch,
            sourceEntityName,
            sourceFieldName: sourceFieldName || undefined,
          }).catch(() => {});
        }
      } catch {
        // Non-critical
      }
    }

    // Build prior discussion summary from existing sessions
    let priorDiscussionSummary: string | undefined;
    const priorSessions = db
      .select({
        id: chatSession.id,
        createdAt: chatSession.createdAt,
        createdByName: user.name,
        messageCount: chatSession.messageCount,
      })
      .from(chatSession)
      .leftJoin(user, eq(chatSession.createdBy, user.id))
      .where(
        and(
          eq(chatSession.fieldMappingId, fieldMappingId),
          eq(chatSession.workspaceId, workspaceId)
        )
      )
      .orderBy(chatSession.createdAt)
      .all();

    if (priorSessions.length > 0) {
      const summaryParts: string[] = [];
      let includedSessionCount = 0;

      for (const ps of priorSessions) {
        const msgs = db
          .select()
          .from(chatMessage)
          .where(eq(chatMessage.sessionId, ps.id))
          .orderBy(chatMessage.createdAt)
          .all();

        // Extract mapping updates proposed in this session
        const mappingUpdates = msgs
          .filter((m) => m.metadata && (m.metadata as Record<string, unknown>).mappingUpdate)
          .map((m) => (m.metadata as Record<string, unknown>).mappingUpdate);

        // Get non-system conversation messages
        const conversationMsgs = msgs.filter((m) => m.role !== "system");

        if (conversationMsgs.length === 0) continue;

        // Skip ghost sessions: sessions where every user message is a kickoff
        const hasRealUserMessage = conversationMsgs.some((m) => {
          if (m.role !== "user") return false;
          const meta = m.metadata as Record<string, unknown> | null;
          return !meta?.kickoff;
        });
        if (!hasRealUserMessage) continue;

        includedSessionCount++;

        const sessionDate = new Date(ps.createdAt).toLocaleDateString();
        summaryParts.push(
          `### Session ${includedSessionCount} (${sessionDate})`
        );

        // Lead with the final mapping outcome
        if (mappingUpdates.length > 0) {
          const lastUpdate = mappingUpdates[mappingUpdates.length - 1] as Record<string, unknown>;
          const outcomeFields: string[] = [];
          if (lastUpdate.sourceEntityName) outcomeFields.push(`source: ${lastUpdate.sourceEntityName}.${lastUpdate.sourceFieldName || "?"}`);
          if (lastUpdate.mappingType) outcomeFields.push(`type: ${lastUpdate.mappingType}`);
          if (lastUpdate.confidence) outcomeFields.push(`confidence: ${lastUpdate.confidence}`);
          summaryParts.push(`**Final mapping proposed**: ${outcomeFields.join(", ")}`);
          if (lastUpdate.transform) {
            const xform = String(lastUpdate.transform);
            summaryParts.push(`**Transform**: ${xform.length > 200 ? xform.slice(0, 200) + "..." : xform}`);
          }
        } else {
          summaryParts.push(`**Outcome**: No mapping update was submitted in this session.`);
        }

        // Extract corrections/feedback from reviewer (non-kickoff user messages)
        const reviewerFeedback = conversationMsgs.filter((m) => {
          if (m.role !== "user") return false;
          const meta = m.metadata as Record<string, unknown> | null;
          return !meta?.kickoff;
        });

        if (reviewerFeedback.length > 0) {
          summaryParts.push(`\n**Key feedback from reviewer:**`);
          // Show last 3 reviewer messages — these tend to be the most refined corrections
          for (const msg of reviewerFeedback.slice(-3)) {
            const content = msg.content.length > 400
              ? msg.content.slice(0, 400) + "..."
              : msg.content;
            summaryParts.push(`- ${content}`);
          }
        }

        summaryParts.push(""); // blank line between sessions
      }

      if (includedSessionCount > 0) {
        summaryParts.unshift(
          `There have been ${includedSessionCount} prior discussion session(s) about this mapping. Review the corrections below carefully — do NOT repeat mistakes that were already addressed.\n`
        );
        priorDiscussionSummary = summaryParts.join("\n");
      }
    }

    // Gather entity-level learnings from sibling field sessions
    let entityLearnings: { fieldName: string; correction: string }[] | undefined;
    const siblingFieldSessions = db
      .select({
        id: chatSession.id,
        fieldMappingId: chatSession.fieldMappingId,
        targetFieldId: chatSession.targetFieldId,
        messageCount: chatSession.messageCount,
      })
      .from(chatSession)
      .where(
        and(
          eq(chatSession.entityId, targetEntity.id),
          eq(chatSession.workspaceId, workspaceId),
          ne(chatSession.fieldMappingId, fieldMappingId)
        )
      )
      .orderBy(desc(chatSession.createdAt))
      .all();

    if (siblingFieldSessions.length > 0) {
      const learnings: { fieldName: string; correction: string }[] = [];
      // Take only the most recent session per sibling field
      const seenFields = new Set<string>();

      for (const sfs of siblingFieldSessions) {
        if (!sfs.fieldMappingId || !sfs.targetFieldId) continue;
        if (seenFields.has(sfs.fieldMappingId)) continue;
        seenFields.add(sfs.fieldMappingId);

        // Get the target field name
        const targetFld = db
          .select({ name: field.name, displayName: field.displayName })
          .from(field)
          .where(eq(field.id, sfs.targetFieldId))
          .get();

        if (!targetFld) continue;
        const fldName = targetFld.displayName || targetFld.name;

        // Get reviewer feedback (non-kickoff user messages)
        const msgs = db
          .select()
          .from(chatMessage)
          .where(eq(chatMessage.sessionId, sfs.id))
          .orderBy(chatMessage.createdAt)
          .all();

        const feedback = msgs.filter((m) => {
          if (m.role !== "user") return false;
          const meta = m.metadata as Record<string, unknown> | null;
          return !meta?.kickoff;
        });

        if (feedback.length === 0) continue;

        // Take the last 2 feedback messages as key corrections
        const recentFeedback = feedback.slice(-2);
        const corrections = recentFeedback
          .map((m) =>
            m.content.length > 250 ? m.content.slice(0, 250) + "..." : m.content
          )
          .join(" → ");

        learnings.push({ fieldName: fldName, correction: corrections });

        if (learnings.length >= 8) break; // Cap to avoid context bloat
      }

      if (learnings.length > 0) {
        entityLearnings = learnings;
      }
    }

    // Also query structured learnings from training (knowledge base)
    const structuredLearnings = db
      .select({
        content: learning.content,
        fieldName: learning.fieldName,
        scope: learning.scope,
      })
      .from(learning)
      .where(
        and(
          eq(learning.workspaceId, workspaceId),
          or(
            eq(learning.entityId, targetEntity.id),
            eq(learning.scope, "workspace")
          )
        )
      )
      .orderBy(desc(learning.createdAt))
      .limit(10)
      .all();

    // Merge field-scope structured learnings into entityLearnings
    for (const sl of structuredLearnings) {
      if (sl.scope === "field" && sl.fieldName) {
        if (!entityLearnings) entityLearnings = [];
        entityLearnings.push({ fieldName: sl.fieldName, correction: sl.content });
      }
    }

    // Cross-entity learnings — pull from all other entities that have sessions,
    // include entity descriptions so the agent can use domain knowledge to judge relevance
    let crossEntityLearnings:
      | { entityName: string; entityDescription: string | null; fieldName: string; correction: string }[]
      | undefined;

    // Build entity lookup (id → name + description) for all target entities
    const targetEntities = db
      .select({
        id: entity.id,
        name: entity.name,
        displayName: entity.displayName,
        description: entity.description,
      })
      .from(entity)
      .where(
        and(
          eq(entity.workspaceId, workspaceId),
          eq(entity.side, "target")
        )
      )
      .all()
      .filter((e) => e.id !== targetEntity.id);

    if (targetEntities.length > 0) {
      const entityInfoMap = new Map(
        targetEntities.map((e) => [
          e.id,
          { name: e.displayName || e.name, description: e.description },
        ])
      );
      const otherEntityIds = targetEntities.map((e) => e.id);

      // Query sessions from other entities (most recent first)
      const crossSessions = db
        .select({
          id: chatSession.id,
          entityId: chatSession.entityId,
          fieldMappingId: chatSession.fieldMappingId,
          targetFieldId: chatSession.targetFieldId,
        })
        .from(chatSession)
        .where(
          and(
            eq(chatSession.workspaceId, workspaceId),
            ne(chatSession.entityId, targetEntity.id)
          )
        )
        .orderBy(desc(chatSession.createdAt))
        .all()
        .filter((s) => s.entityId && entityInfoMap.has(s.entityId));

      if (crossSessions.length > 0) {
        const learnings: {
          entityName: string;
          entityDescription: string | null;
          fieldName: string;
          correction: string;
        }[] = [];
        const seenCrossFields = new Set<string>();

        for (const cs of crossSessions) {
          if (!cs.fieldMappingId || !cs.targetFieldId) continue;
          if (seenCrossFields.has(cs.fieldMappingId)) continue;
          seenCrossFields.add(cs.fieldMappingId);

          const entInfo = entityInfoMap.get(cs.entityId!);
          if (!entInfo) continue;

          const crossFld = db
            .select({ name: field.name, displayName: field.displayName })
            .from(field)
            .where(eq(field.id, cs.targetFieldId))
            .get();
          if (!crossFld) continue;

          const fldName = crossFld.displayName || crossFld.name;

          const msgs = db
            .select()
            .from(chatMessage)
            .where(eq(chatMessage.sessionId, cs.id))
            .orderBy(chatMessage.createdAt)
            .all();

          const feedback = msgs.filter((m) => {
            if (m.role !== "user") return false;
            const meta = m.metadata as Record<string, unknown> | null;
            return !meta?.kickoff;
          });

          if (feedback.length === 0) continue;

          const lastMsg = feedback[feedback.length - 1];
          const content =
            lastMsg.content.length > 250
              ? lastMsg.content.slice(0, 250) + "..."
              : lastMsg.content;

          learnings.push({
            entityName: entInfo.name,
            entityDescription: entInfo.description,
            fieldName: fldName,
            correction: content,
          });

          if (learnings.length >= 6) break;
        }

        if (learnings.length > 0) {
          crossEntityLearnings = learnings;
        }
      }
    }

    // Inject entity/workspace-scope structured learnings as cross-entity learnings
    for (const sl of structuredLearnings) {
      if (sl.scope === "entity" || sl.scope === "workspace") {
        if (!crossEntityLearnings) crossEntityLearnings = [];
        crossEntityLearnings.push({
          entityName: sl.scope === "workspace" ? "Workspace-wide" : (targetEntity.displayName || targetEntity.name),
          entityDescription: null,
          fieldName: "(entity-level insight)",
          correction: sl.content,
        });
      }
    }

    // Query entity pipeline for structural context
    let entityStructure: {
      structureType: "flat" | "assembly";
      sources: { name: string; alias: string; table: string }[];
      joins?: { left: string; right: string; on: string[]; how: string }[] | null;
      hasConcat: boolean;
    } | undefined;

    const pipeline = db
      .select()
      .from(entityPipeline)
      .where(
        and(
          eq(entityPipeline.entityId, targetEntity.id),
          eq(entityPipeline.isLatest, true)
        )
      )
      .get();

    if (pipeline) {
      const sources = (pipeline.sources as { name: string; alias: string; table: string }[]) || [];
      entityStructure = {
        structureType: pipeline.structureType as "flat" | "assembly",
        sources,
        joins: pipeline.joins as { left: string; right: string; on: string[]; how: string }[] | null,
        hasConcat: !!pipeline.concat,
      };
    }

    // Assemble context and build system message
    // In RAG mode, still assemble context (for fallback + doc count) but agent retrieves on demand
    const tokenBudget = getTokenBudget("claude");
    const assembledCtx = assembleContext(
      workspaceId,
      targetEntity.name,
      ragEnabled ? 0 : tokenBudget // zero budget = metadata only, no content trimming needed
    );

    // Resolve BQ config for prompt builder
    let bqConfigForPrompt = bqConfigForPrefetch;
    if (!bqConfigForPrompt) {
      try {
        const ws = db
          .select({ settings: workspace.settings })
          .from(workspace)
          .where(eq(workspace.id, workspaceId))
          .get();
        bqConfigForPrompt = (ws?.settings as Record<string, unknown> | null)?.bigquery as BigQueryConfig | undefined;
      } catch {
        // Non-critical
      }
    }

    // Derive primary source for schema stats from sibling mappings
    if (ragEnabled && sourceSchemaStats && siblingFields.length > 0) {
      const sourceCounts = new Map<string, number>();
      for (const sf of siblingFields) {
        if (sf.sourceInfo) {
          const table = sf.sourceInfo.split(".")[0];
          sourceCounts.set(table, (sourceCounts.get(table) || 0) + 1);
        }
      }
      let primarySource = "";
      let maxCount = 0;
      for (const [table, count] of sourceCounts) {
        if (count > maxCount) { primarySource = table; maxCount = count; }
      }
      if (primarySource) sourceSchemaStats.primarySource = primarySource;
    }

    // Answered questions for this entity — prevents re-flagging resolved gaps
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
          eq(question.entityId, targetEntity.id),
          eq(question.status, "resolved")
        )
      )
      .all()
      .filter((q) => q.answer)
      .map((q) => ({ question: q.question, answer: q.answer!, fieldName: q.fieldName }));

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
      currentMapping: {
        mappingType: mapping.mappingType,
        sourceEntityName,
        sourceFieldName,
        transform: mapping.transform,
        defaultValue: mapping.defaultValue,
        enumMapping: mapping.enumMapping,
        reasoning: mapping.reasoning,
        confidence: mapping.confidence,
        notes: mapping.notes,
      },
      assembledContext: assembledCtx,
      sourceSchema,
      sourceDataPreview: null,
      priorDiscussionSummary,
      entityLearnings,
      crossEntityLearnings,
      siblingFields,
      bigqueryAvailable: !!bqConfigForPrompt,
      bigqueryDataset: bqConfigForPrompt
        ? `${bqConfigForPrompt.projectId}.${bqConfigForPrompt.sourceDataset}`
        : undefined,
      entityStructure,
      pipelineYamlSpec: pipeline?.yamlSpec ?? undefined,
      ragEnabled,
      sourceSchemaStats,
      answeredQuestions: answeredQs.length > 0 ? answeredQs : undefined,
    });

    // Create session
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(chatSession)
      .values({
        id: sessionId,
        workspaceId,
        fieldMappingId,
        targetFieldId: targetField.id,
        entityId: targetEntity.id,
        status: "active",
        messageCount: 1,
        lastMessageAt: now,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }).run();

    // Save system message with context
    db.insert(chatMessage)
      .values({
        sessionId,
        role: "system",
        content: systemMessage + "\n\n" + contextMessage,
        createdAt: now,
      }).run();

    const session = db
      .select()
      .from(chatSession)
      .where(eq(chatSession.id, sessionId))
      .get();

    return NextResponse.json(session);
  },
  { requiredRole: "editor" }
);
