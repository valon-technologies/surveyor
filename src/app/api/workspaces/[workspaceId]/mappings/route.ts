import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity, commentThread, comment } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createMappingSchema } from "@/lib/validators/mapping";
import { logActivity } from "@/lib/activity/log-activity";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get("status");
  const entityId = searchParams.get("entityId");

  const conditions = [
    eq(fieldMapping.workspaceId, workspaceId),
    eq(fieldMapping.isLatest, true),
  ];
  if (status) conditions.push(eq(fieldMapping.status, status));

  let mappings = await db
    .select()
    .from(fieldMapping)
    .where(and(...conditions));

  // Filter by entity if specified (requires joining through field)
  if (entityId) {
    const entityFieldIds = (await db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, entityId)))
      .map((f) => f.id);

    mappings = mappings.filter((m) => entityFieldIds.includes(m.targetFieldId));
  }

  return NextResponse.json(mappings);
});

export const POST = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const body = await req.json();
  const parsed = createMappingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  // Mark any existing latest mapping for this field as not latest
  await db.update(fieldMapping)
    .set({ isLatest: false })
    .where(
      and(
        eq(fieldMapping.targetFieldId, input.targetFieldId),
        eq(fieldMapping.isLatest, true)
      )
    );

  // Get the current version number
  const existing = await db
    .select({ version: fieldMapping.version })
    .from(fieldMapping)
    .where(eq(fieldMapping.targetFieldId, input.targetFieldId));
  const nextVersion = existing.length > 0 ? Math.max(...existing.map((e) => e.version)) + 1 : 1;
  const parentMapping = existing.length > 0
    ? (await db.select({ id: fieldMapping.id }).from(fieldMapping)
        .where(and(eq(fieldMapping.targetFieldId, input.targetFieldId)))).at(-1)
    : undefined;

  // New mappings always start as "pending"
  const [mapping] = await db
    .insert(fieldMapping)
    .values({
      workspaceId,
      targetFieldId: input.targetFieldId,
      status: "pending",
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
      createdBy: input.createdBy || "manual",
      version: nextVersion,
      parentId: parentMapping?.id,
      isLatest: true,
    })
    .returning();

  // Get entity for activity
  const targetField = (await db.select().from(field).where(eq(field.id, input.targetFieldId)))[0];

  await logActivity({
    workspaceId,
    fieldMappingId: mapping.id,
    entityId: targetField?.entityId || null,
    actorId: userId,
    actorName: input.createdBy || "manual",
    action: "mapping_saved",
    detail: { version: mapping.version, isNew: true },
  });

  // Auto-create review thread for non-high-confidence mappings with reviewComment
  if (input.reviewComment && input.confidence !== "high") {
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
      .returning();

    await db.insert(comment)
      .values({
        threadId: thread.id,
        authorName: "AI Auto-Map",
        body: input.reviewComment,
        bodyFormat: "markdown",
      });
  }

  return NextResponse.json(mapping, { status: 201 });
}, { requiredRole: "editor" });
