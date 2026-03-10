/**
 * Shared question resolution logic.
 * Extracted from the resolve API route so it can be reused by:
 * - The resolve API endpoint (reviewer resolves in-app)
 * - The client Q&A import (bulk resolve from XLSX)
 */
import { db } from "@/lib/db";
import { question, questionReply, fieldMapping, learning, field, schemaAsset, entity, user } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { rebuildEntityKnowledge } from "@/lib/generation/entity-knowledge";
import { evaluateResolution } from "@/lib/generation/answer-evaluator";

/**
 * Heuristic: does the answer indicate the field has no available source data?
 * Used to auto-exclude the linked mapping.
 */
function isExcludeSignal(answer: string): boolean {
  const lower = answer.toLowerCase();
  const patterns = [
    "do not keep track", "don't keep track", "do not have", "don't have",
    "does not exist", "doesn't exist", "not available", "no source",
    "not provided", "not tracked", "no data", "not applicable", "n/a",
    "we don't track", "we do not track", "not in the extract", "not in the data",
    "does not provide", "doesn't provide", "deprecated", "good to exclude",
    "skip this", "skip both", "do not map", "don't map",
    "should not be mapped", "shouldn't be mapped", "exclude it", "exclude this",
  ];
  return patterns.some((p) => lower.includes(p));
}

export interface ResolveQuestionInput {
  questionId: string;
  workspaceId: string;
  answerText: string;
  resolvedByUserId: string;
  resolvedByName: string;
  /** "review" for in-app resolution, "client" for imported client answers */
  source?: "review" | "client";
}

export interface ResolveQuestionResult {
  success: boolean;
  cascadeCount: number;
  autoExcluded: boolean;
}

export async function resolveQuestion(input: ResolveQuestionInput): Promise<ResolveQuestionResult> {
  const { questionId, workspaceId, answerText, resolvedByUserId, resolvedByName, source = "review" } = input;
  const now = new Date().toISOString();

  // Load the question
  const [q] = await db.select().from(question)
    .where(and(eq(question.id, questionId), eq(question.workspaceId, workspaceId)));

  if (!q) throw new Error(`Question ${questionId} not found`);
  if (q.status !== "open") throw new Error(`Question ${questionId} is not open (status: ${q.status})`);

  // Create resolution reply
  let newReplyCount = q.replyCount;
  if (answerText) {
    await db.insert(questionReply).values({
      questionId,
      authorId: resolvedByUserId,
      authorName: resolvedByName,
      authorRole: source === "client" ? "system" : "user",
      body: answerText,
      isResolution: true,
    });
    newReplyCount += 1;
  }

  // Mark question as resolved
  const [updated] = await db.update(question)
    .set({
      status: "resolved",
      resolvedBy: resolvedByUserId,
      resolvedByName: source === "client" ? `Client (imported by ${resolvedByName})` : resolvedByName,
      resolvedAt: now,
      replyCount: newReplyCount,
      answer: answerText || q.answer,
      answeredBy: resolvedByUserId,
      updatedAt: now,
    })
    .where(eq(question.id, questionId))
    .returning();

  // ── Side effects ──────────────────────────────────────
  let cascadeCount = 0;
  let autoExcluded = false;

  if (answerText) {
    // Resolve field name
    let fieldName: string | null = null;
    if (updated.fieldId) {
      const [f] = await db.select({ name: field.name }).from(field)
        .where(eq(field.id, updated.fieldId)).limit(1);
      fieldName = f?.name || null;
    }

    // 1. Auto-exclude mapping if answer indicates no source
    if (updated.fieldMappingId && isExcludeSignal(answerText)) {
      await db.update(fieldMapping)
        .set({
          status: "excluded",
          mappingType: "not_applicable",
          reasoning: `${source === "client" ? "Client" : "SM"} answer: ${answerText}`,
          notes: `Auto-excluded from resolved question (${updated.id})`,
          assigneeId: resolvedByUserId,
          editedBy: resolvedByName,
          updatedAt: now,
        })
        .where(eq(fieldMapping.id, updated.fieldMappingId));
      autoExcluded = true;
    }

    // 2. Schema context for learning record
    let schemaContext = "";
    if (updated.schemaAssetIds?.length) {
      const assets = await db
        .select({ id: schemaAsset.id, name: schemaAsset.name, side: schemaAsset.side })
        .from(schemaAsset)
        .where(inArray(schemaAsset.id, updated.schemaAssetIds));

      if (assets.length > 0) {
        const parts = await Promise.all(assets.map(async (a) => {
          const entityNames = (await db
            .select({ name: entity.name })
            .from(entity)
            .where(eq(entity.schemaAssetId, a.id))
          ).map((e) => e.name);
          const entitiesStr = entityNames.length > 0
            ? `, ${entityNames.length} entities: ${entityNames.join(", ")}`
            : "";
          return `"${a.name}" (${a.side}${entitiesStr})`;
        }));
        schemaContext = ` Referenced schema: ${parts.join("; ")}.`;
      }
    }

    // 3. Create learning record (pending admin validation)
    await db.insert(learning).values({
      workspaceId,
      entityId: updated.entityId,
      fieldName,
      scope: fieldName ? "field" : "entity",
      content: `Q: "${updated.question}" (field: ${fieldName || "entity-level"}) — A: ${answerText}${schemaContext}`,
      source,
      sessionId: updated.chatSessionId,
      validationStatus: "pending",
      createdAt: now,
    });

    // 4. AI follow-up evaluation (fire-and-forget for LLM questions)
    if (updated.askedBy === "llm" && answerText) {
      evaluateResolution({
        workspaceId,
        questionId,
        resolverUserId: resolvedByUserId,
        resolverName: resolvedByName,
        resolutionText: answerText,
      }).catch((err) => console.warn("[resolve] AI follow-up failed:", err));
    }

    // 5. Cascade resolution for sibling entities
    if (updated.fieldId && updated.entityId) {
      try {
        const [resolvedField] = await db.select({ name: field.name }).from(field)
          .where(eq(field.id, updated.fieldId)).limit(1);

        const [thisEntity] = await db.select({ parentEntityId: entity.parentEntityId }).from(entity)
          .where(eq(entity.id, updated.entityId)).limit(1);
        const siblingEntityIds: string[] = [];
        if (thisEntity?.parentEntityId && resolvedField) {
          const siblings = (await db.select({ id: entity.id }).from(entity)
            .where(and(
              eq(entity.workspaceId, workspaceId),
              eq(entity.parentEntityId, thisEntity.parentEntityId),
            ))).filter((s) => s.id !== updated.entityId);
          siblingEntityIds.push(...siblings.map((s) => s.id));
        }

        const cascadeFieldIds = [updated.fieldId];
        if (siblingEntityIds.length > 0 && resolvedField) {
          const siblingFields = await db.select({ id: field.id }).from(field)
            .where(and(
              inArray(field.entityId, siblingEntityIds),
              eq(field.name, resolvedField.name),
            ));
          cascadeFieldIds.push(...siblingFields.map((f) => f.id));
        }

        const allEntityIds = [updated.entityId, ...siblingEntityIds];

        const relatedOpen = (await db.select().from(question)
          .where(and(
            eq(question.workspaceId, workspaceId),
            inArray(question.entityId, allEntityIds),
            inArray(question.fieldId, cascadeFieldIds),
            eq(question.status, "open"),
          ))).filter((rq) => rq.id !== questionId);

        for (const rq of relatedOpen) {
          await db.update(question)
            .set({
              status: "resolved",
              answer: answerText,
              answeredBy: resolvedByUserId,
              resolvedBy: resolvedByUserId,
              resolvedByName,
              resolvedAt: now,
              autoResolvedFrom: questionId,
              updatedAt: now,
            })
            .where(eq(question.id, rq.id));

          await db.insert(questionReply).values({
            questionId: rq.id,
            authorId: null,
            authorName: "System",
            authorRole: "system",
            body: `Auto-resolved: sibling entity question about "${resolvedField?.name || "this field"}" was answered — "${answerText}"`,
            isResolution: true,
          });

          await db.update(question)
            .set({ replyCount: rq.replyCount + 1 })
            .where(eq(question.id, rq.id));

          cascadeCount++;
        }

        for (const sibId of siblingEntityIds) {
          if (relatedOpen.some((rq) => rq.entityId === sibId)) {
            rebuildEntityKnowledge(workspaceId, sibId);
          }
        }

        if (cascadeCount > 0) {
          console.log(`[resolve] Cascade-resolved ${cascadeCount} related questions for field "${resolvedField?.name}"`);
        }
      } catch (cascadeErr) {
        console.warn("[resolve] Cascade resolution failed (non-blocking):", cascadeErr);
      }
    }
  }

  return { success: true, cascadeCount, autoExcluded };
}
