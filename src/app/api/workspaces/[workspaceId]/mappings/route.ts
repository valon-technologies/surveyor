import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fieldMapping, field, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createMappingSchema } from "@/lib/validators/mapping";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get("status");
  const entityId = searchParams.get("entityId");

  const conditions = [
    eq(fieldMapping.workspaceId, workspaceId),
    eq(fieldMapping.isLatest, true),
  ];
  if (status) conditions.push(eq(fieldMapping.status, status));

  let mappings = db
    .select()
    .from(fieldMapping)
    .where(and(...conditions))
    .all();

  // Filter by entity if specified (requires joining through field)
  if (entityId) {
    const entityFieldIds = db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, entityId))
      .all()
      .map((f) => f.id);

    mappings = mappings.filter((m) => entityFieldIds.includes(m.targetFieldId));
  }

  return NextResponse.json(mappings);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const body = await req.json();
  const parsed = createMappingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  // Mark any existing latest mapping for this field as not latest
  db.update(fieldMapping)
    .set({ isLatest: false })
    .where(
      and(
        eq(fieldMapping.targetFieldId, input.targetFieldId),
        eq(fieldMapping.isLatest, true)
      )
    )
    .run();

  // Get the current version number
  const existing = db
    .select({ version: fieldMapping.version })
    .from(fieldMapping)
    .where(eq(fieldMapping.targetFieldId, input.targetFieldId))
    .all();
  const nextVersion = existing.length > 0 ? Math.max(...existing.map((e) => e.version)) + 1 : 1;
  const parentMapping = existing.length > 0
    ? db.select({ id: fieldMapping.id }).from(fieldMapping)
        .where(and(eq(fieldMapping.targetFieldId, input.targetFieldId)))
        .all().at(-1)
    : undefined;

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
      createdBy: input.createdBy || "manual",
      version: nextVersion,
      parentId: parentMapping?.id,
      isLatest: true,
    })
    .returning()
    .all();

  return NextResponse.json(mapping, { status: 201 });
}
