import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, commentThread, comment } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { bulkCreateMappingsSchema } from "@/lib/validators/mapping";
import { createMappingVersionByTargetField } from "@/lib/db/copy-on-write";

export const POST = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const body = await req.json();
  const parsed = bulkCreateMappingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { mappings: inputs, generationId } = parsed.data;
  const created: typeof fieldMapping.$inferSelect[] = [];

  for (const input of inputs) {
    const mapping = await createMappingVersionByTargetField(input.targetFieldId, {
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
    });

    created.push(mapping);

    // Auto-create review thread for non-high-confidence mappings with reviewComment
    if (input.reviewComment && input.confidence !== "high") {
      const [targetField] = await db.select().from(field).where(eq(field.id, input.targetFieldId)).limit(1);

      const [thread] = await db
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
        ;

      await db.insert(comment)
        .values({
          threadId: thread.id,
          authorName: "AI Auto-Map",
          body: input.reviewComment,
          bodyFormat: "markdown",
        })
        ;
    }
  }

  return NextResponse.json(created, { status: 201 });
}, { requiredRole: "editor" });
