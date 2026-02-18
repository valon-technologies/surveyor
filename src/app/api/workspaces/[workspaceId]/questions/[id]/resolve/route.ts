import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, questionReply, fieldMapping, learning, field, schemaAsset, entity, user } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { resolveQuestionSchema } from "@/lib/validators/question";

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
        content: `SM answered context gap: ${answerText}${schemaContext}`,
        source: "review",
        sessionId: updated.chatSessionId,
        createdAt: now,
      })
      .run();
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });
