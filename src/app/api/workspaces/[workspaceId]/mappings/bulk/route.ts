import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, commentThread, comment } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { bulkCreateMappingsSchema } from "@/lib/validators/mapping";

export const POST = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const body = await req.json();
  const parsed = bulkCreateMappingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { mappings: inputs, generationId } = parsed.data;
  const created: typeof fieldMapping.$inferSelect[] = [];

  for (const input of inputs) {
    // Mark existing as not latest
    db.update(fieldMapping)
      .set({ isLatest: false })
      .where(
        and(
          eq(fieldMapping.targetFieldId, input.targetFieldId),
          eq(fieldMapping.isLatest, true)
        )
      )
      .run();

    const [mapping] = db
      .insert(fieldMapping)
      .values({
        workspaceId,
        targetFieldId: input.targetFieldId,
        status: input.status,
        mappingType: input.mappingType,
        assigneeId: input.assigneeId,
        sourceEntityId: input.sourceEntityId,
        sourceFieldId: input.sourceFieldId,
        transform: input.transform,
        defaultValue: input.defaultValue,
        enumMapping: input.enumMapping,
        reasoning: input.reasoning,
        confidence: input.confidence,
        notes: input.notes,
        createdBy: input.createdBy || "llm",
        generationId,
        version: 1,
        isLatest: true,
      })
      .returning()
      .all();

    created.push(mapping);

    // Auto-create review thread for non-high-confidence mappings with reviewComment
    if (input.reviewComment && input.confidence !== "high") {
      const targetField = db.select().from(field).where(eq(field.id, input.targetFieldId)).get();

      const [thread] = db
        .insert(commentThread)
        .values({
          workspaceId,
          entityId: targetField?.entityId || null,
          fieldMappingId: mapping.id,
          subject: `AI Review: ${input.confidence || "uncertain"} confidence mapping`,
          createdBy: "AI Auto-Map",
          commentCount: 1,
        })
        .returning()
        .all();

      db.insert(comment)
        .values({
          threadId: thread.id,
          authorName: "AI Auto-Map",
          body: input.reviewComment,
          bodyFormat: "markdown",
        })
        .run();
    }
  }

  return NextResponse.json(created, { status: 201 });
}, { requiredRole: "editor" });
