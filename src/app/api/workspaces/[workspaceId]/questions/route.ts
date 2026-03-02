import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question, entity, field, schemaAsset, user } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createQuestionSchema } from "@/lib/validators/question";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get("status");
  const entityId = searchParams.get("entityId");

  const conditions = [eq(question.workspaceId, workspaceId)];
  if (status) conditions.push(eq(question.status, status));
  if (entityId) conditions.push(eq(question.entityId, entityId));

  const fieldMappingId = searchParams.get("fieldMappingId");
  if (fieldMappingId) {
    conditions.push(eq(question.fieldMappingId, fieldMappingId));
  }

  const targetForTeam = searchParams.get("targetForTeam");
  if (targetForTeam) {
    conditions.push(eq(question.targetForTeam, targetForTeam));
    // Client views only see approved questions
    conditions.push(eq(question.curationStatus, "approved"));
  }

  const rows = db
    .select({
      question: question,
      entityName: entity.name,
      entityDisplayName: entity.displayName,
      fieldName: field.name,
      fieldDisplayName: field.displayName,
    })
    .from(question)
    .leftJoin(entity, eq(question.entityId, entity.id))
    .leftJoin(field, eq(question.fieldId, field.id))
    .where(and(...conditions))
    .orderBy(question.createdAt)
    .all();

  // Batch-resolve schema asset IDs (no N+1)
  const allSchemaAssetIds = [
    ...new Set(rows.flatMap((r) => r.question.schemaAssetIds ?? [])),
  ];
  const schemaAssetMap = new Map<string, { id: string; name: string; side: string }>();
  if (allSchemaAssetIds.length > 0) {
    const assets = db
      .select({ id: schemaAsset.id, name: schemaAsset.name, side: schemaAsset.side })
      .from(schemaAsset)
      .where(inArray(schemaAsset.id, allSchemaAssetIds))
      .all();
    for (const a of assets) schemaAssetMap.set(a.id, a);
  }

  // Batch-resolve assignee IDs (no N+1)
  const allAssigneeIds = [
    ...new Set(rows.flatMap((r) => r.question.assigneeIds ?? [])),
  ];
  const assigneeMap = new Map<string, { userId: string; name: string | null; email: string; image: string | null }>();
  if (allAssigneeIds.length > 0) {
    const users = db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(inArray(user.id, allAssigneeIds))
      .all();
    for (const u of users) assigneeMap.set(u.id, { userId: u.id, name: u.name, email: u.email, image: u.image });
  }

  const questions = rows.map((r) => ({
    ...r.question,
    entityName: r.entityDisplayName || r.entityName || null,
    fieldName: r.fieldDisplayName || r.fieldName || null,
    schemaAssets: (r.question.schemaAssetIds ?? [])
      .map((id) => schemaAssetMap.get(id))
      .filter(Boolean),
    assignees: (r.question.assigneeIds ?? [])
      .map((id) => assigneeMap.get(id))
      .filter(Boolean),
  }));

  return NextResponse.json(questions);
});

export const POST = withAuth(async (req, ctx, { userId, workspaceId }) => {
  const body = await req.json();
  const parsed = createQuestionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = db
    .insert(question)
    .values({
      workspaceId,
      entityId: input.entityId,
      fieldId: input.fieldId,
      question: input.question,
      askedBy: input.askedBy || "user",
      priority: input.priority,
      targetForTeam: input.targetForTeam,
      fieldMappingId: input.fieldMappingId,
      chatSessionId: input.chatSessionId,
      assigneeIds: input.assigneeIds,
      createdByUserId: userId,
    })
    .returning()
    .all();

  return NextResponse.json(created, { status: 201 });
}, { requiredRole: "editor" });
