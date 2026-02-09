import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { bulkCreateMappingsSchema } from "@/lib/validators/mapping";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
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
  }

  return NextResponse.json(created, { status: 201 });
}
