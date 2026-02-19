import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, questionReply, fieldMapping, learning, field, schemaAsset, entity, user } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { resolveQuestionSchema } from "@/lib/validators/question";
import { rebuildEntityKnowledge } from "@/lib/generation/entity-knowledge";
import { evaluateResolution } from "@/lib/generation/answer-evaluator";

/**
 * Heuristic: does the answer indicate the field has no available source data?
 * Used to auto-exclude the linked mapping.
 */
function isExcludeSignal(answer: string): boolean {
  const lower = answer.toLowerCase();
  const patterns = [
    "do not keep track",
    "don't keep track",
    "do not have",
    "don't have",
    "does not exist",
    "doesn't exist",
    "not available",
    "no source",
    "not provided",
    "not tracked",
    "no data",
    "not applicable",
    "n/a",
    "we don't track",
    "we do not track",
    "not in the extract",
    "not in the data",
    "does not provide",
    "doesn't provide",
    "deprecated",
    "good to exclude",
    "skip this",
    "skip both",
    "do not map",
    "don't map",
    "should not be mapped",
    "shouldn't be mapped",
    "exclude it",
    "exclude this",
  ];
  return patterns.some((p) => lower.includes(p));
}

export const POST = withAuth(async (req, ctx, { userId, workspaceId }) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = resolveQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Verify question exists in workspace
  const q = db
    .select()
    .from(question)
    .where(and(eq(question.id, id), eq(question.workspaceId, workspaceId)))
    .get();

  if (!q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  if (q.status !== "open") {
    return NextResponse.json({ error: "Question is not open" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const resolutionBody = parsed.data.body?.trim();

  // Look up author name
  const u = db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  const authorName = u?.name || "User";

  let newReplyCount = q.replyCount;

  // If resolution body provided, create a reply with isResolution=true
  if (resolutionBody) {
    db.insert(questionReply)
      .values({
        questionId: id,
        authorId: userId,
        authorName,
        authorRole: "user",
        body: resolutionBody,
        isResolution: true,
      })
      .run();
    newReplyCount += 1;
  }

  // Update question to resolved
  const [updated] = db
    .update(question)
    .set({
      status: "resolved",
      resolvedBy: userId,
      resolvedByName: authorName,
      resolvedAt: now,
      replyCount: newReplyCount,
      // Backward compat
      answer: resolutionBody || q.answer,
      answeredBy: userId,
      updatedAt: now,
    })
    .where(eq(question.id, id))
    .returning()
    .all();

  // ── Side effects ──────────────────────────────────────────
  const answerText = resolutionBody || q.answer;
  let cascadeCount = 0;

  if (answerText) {
    // Resolve field name for the learning record
    let fieldName: string | null = null;
    if (updated.fieldId) {
      const f = db.select({ name: field.name }).from(field)
        .where(eq(field.id, updated.fieldId)).get();
      fieldName = f?.name || null;
    }

    // 1. Auto-exclude mapping if the answer indicates no source data
    if (updated.fieldMappingId && isExcludeSignal(answerText)) {
      db.update(fieldMapping)
        .set({
          status: "excluded",
          mappingType: "not_applicable",
          reasoning: `SM answer: ${answerText}`,
          notes: `Auto-excluded from resolved question (${updated.id})`,
          assigneeId: userId,
          editedBy: authorName,
          updatedAt: now,
        })
        .where(eq(fieldMapping.id, updated.fieldMappingId))
        .run();
    }

    // 2. Resolve schema context for the learning record
    let schemaContext = "";
    if (updated.schemaAssetIds?.length) {
      const assets = db
        .select({ id: schemaAsset.id, name: schemaAsset.name, side: schemaAsset.side })
        .from(schemaAsset)
        .where(inArray(schemaAsset.id, updated.schemaAssetIds))
        .all();

      if (assets.length > 0) {
        const parts = assets.map((a) => {
          const entityNames = db
            .select({ name: entity.name })
            .from(entity)
            .where(eq(entity.schemaAssetId, a.id))
            .all()
            .map((e) => e.name);
          const entitiesStr = entityNames.length > 0
            ? `, ${entityNames.length} entities: ${entityNames.join(", ")}`
            : "";
          return `"${a.name}" (${a.side}${entitiesStr})`;
        });
        schemaContext = ` Referenced schema: ${parts.join("; ")}.`;
      }
    }

    // 3. Always create a learning record
    db.insert(learning)
      .values({
        workspaceId,
        entityId: updated.entityId,
        fieldName,
        scope: fieldName ? "field" : "entity",
        content: `Q: "${updated.question}" (field: ${fieldName || "entity-level"}) — A: ${answerText}${schemaContext}`,
        source: "review",
        sessionId: updated.chatSessionId,
        createdAt: now,
      })
      .run();

    // 4. Rebuild Entity Knowledge context (single source of truth via RAG)
    if (updated.entityId) {
      rebuildEntityKnowledge(workspaceId, updated.entityId);
    }

    // 5. AI follow-up evaluation (fire-and-forget — async, non-blocking)
    if (updated.askedBy === "llm" && answerText) {
      evaluateResolution({
        workspaceId,
        questionId: id,
        resolverUserId: userId,
        resolverName: authorName,
        resolutionText: answerText,
      }).catch((err) => console.warn("[resolve] AI follow-up failed:", err));
    }

    // 6. Cascade resolution: auto-resolve other open questions for same entity+field
    //    AND sibling component entities with the same field name (assembly dedup)
    if (updated.fieldId && updated.entityId) {
      try {
        // Resolve the field name for cross-entity matching
        const resolvedField = db.select({ name: field.name }).from(field)
          .where(eq(field.id, updated.fieldId)).get();

        // Find sibling component entities (same parentEntityId)
        const thisEntity = db.select({ parentEntityId: entity.parentEntityId }).from(entity)
          .where(eq(entity.id, updated.entityId)).get();
        const siblingEntityIds: string[] = [];
        if (thisEntity?.parentEntityId && resolvedField) {
          const siblings = db.select({ id: entity.id }).from(entity)
            .where(and(
              eq(entity.workspaceId, workspaceId),
              eq(entity.parentEntityId, thisEntity.parentEntityId),
            )).all().filter((s) => s.id !== updated.entityId);
          siblingEntityIds.push(...siblings.map((s) => s.id));
        }

        // Build list of all field IDs to cascade to (same field + sibling fields by name)
        const cascadeFieldIds = [updated.fieldId];
        if (siblingEntityIds.length > 0 && resolvedField) {
          const siblingFields = db.select({ id: field.id }).from(field)
            .where(and(
              inArray(field.entityId, siblingEntityIds),
              eq(field.name, resolvedField.name),
            )).all();
          cascadeFieldIds.push(...siblingFields.map((f) => f.id));
        }

        const allEntityIds = [updated.entityId, ...siblingEntityIds];

        const relatedOpen = db
          .select()
          .from(question)
          .where(
            and(
              eq(question.workspaceId, workspaceId),
              inArray(question.entityId, allEntityIds),
              inArray(question.fieldId, cascadeFieldIds),
              eq(question.status, "open"),
            )
          )
          .all()
          .filter((rq) => rq.id !== id);

        for (const rq of relatedOpen) {
          db.update(question)
            .set({
              status: "resolved",
              answer: answerText,
              answeredBy: userId,
              resolvedBy: userId,
              resolvedByName: authorName,
              resolvedAt: now,
              autoResolvedFrom: id,
              updatedAt: now,
            })
            .where(eq(question.id, rq.id))
            .run();

          db.insert(questionReply)
            .values({
              questionId: rq.id,
              authorId: null,
              authorName: "System",
              authorRole: "system",
              body: `Auto-resolved: sibling entity question about "${resolvedField?.name || "this field"}" was answered — "${answerText}"`,
              isResolution: true,
            })
            .run();

          db.update(question)
            .set({ replyCount: rq.replyCount + 1 })
            .where(eq(question.id, rq.id))
            .run();

          cascadeCount++;
        }

        // Rebuild entity knowledge for affected sibling entities too
        for (const sibId of siblingEntityIds) {
          if (relatedOpen.some((rq) => rq.entityId === sibId)) {
            rebuildEntityKnowledge(workspaceId, sibId);
          }
        }

        if (cascadeCount > 0) {
          console.log(`[resolve] Cascade-resolved ${cascadeCount} related questions (including ${siblingEntityIds.length} sibling entities) for field "${resolvedField?.name}"`);
        }
      } catch (cascadeErr) {
        console.warn("[resolve] Cascade resolution failed (non-blocking):", cascadeErr);
      }
    }
  }

  return NextResponse.json({ ...updated, cascadeCount });
}, { requiredRole: "editor" });
