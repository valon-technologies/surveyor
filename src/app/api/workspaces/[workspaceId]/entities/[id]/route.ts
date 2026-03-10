import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { entity, field, fieldMapping, question, user } from "@/lib/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { updateEntitySchema } from "@/lib/validators/entity";
import type { EntityStatus } from "@/lib/constants";

function deriveEntityStatus(
  statusBreakdown: Record<string, number>,
  fieldCount: number
): EntityStatus {
  if (fieldCount === 0) return "not_started";

  const accepted = statusBreakdown["accepted"] || 0;
  const excluded = statusBreakdown["excluded"] || 0;
  const unreviewed = statusBreakdown["unreviewed"] || 0;
  const punted = statusBreakdown["punted"] || 0;
  const needsDiscussion = statusBreakdown["needs_discussion"] || 0;

  if (accepted + excluded === fieldCount) return "complete";
  if (punted > 0 || needsDiscussion > 0) return "review";
  if (accepted > 0 || unreviewed > 0) return "in_progress";
  return "not_started";
}

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;

  const ent = (await db
    .select()
    .from(entity)
    .where(and(eq(entity.id, id), eq(entity.workspaceId, workspaceId)))
)[0];

  if (!ent) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  // Get fields with their latest mappings
  const fields = await db
    .select()
    .from(field)
    .where(eq(field.entityId, id))
    .orderBy(field.sortOrder)
    ;

  const fieldsWithMappings = [];
  for (const f of fields) {
    const mapping = (await db
      .select()
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.targetFieldId, f.id),
          eq(fieldMapping.isLatest, true)
        )
      )
      )[0];

    // If we have a mapping with source field, get the source names
    let sourceEntityName: string | undefined;
    let sourceFieldName: string | undefined;
    if (mapping?.sourceFieldId) {
      const sf = (await db
        .select()
        .from(field)
        .where(eq(field.id, mapping.sourceFieldId))
        )[0];
      if (sf) {
        sourceFieldName = sf.name;
        const se = (await db
          .select()
          .from(entity)
          .where(eq(entity.id, sf.entityId))
          )[0];
        sourceEntityName = se?.name;
      }
    } else if (mapping?.sourceEntityId) {
      const se = (await db
        .select()
        .from(entity)
        .where(eq(entity.id, mapping.sourceEntityId))
        )[0];
      sourceEntityName = se?.name;
    }

    // Resolve assignee name
    let assigneeName: string | null = null;
    if (mapping?.assigneeId) {
      const assignee = (await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, mapping.assigneeId))
        )[0];
      assigneeName = assignee?.name || null;
    }

    fieldsWithMappings.push({
      ...f,
      mapping: mapping
        ? {
            id: mapping.id,
            status: mapping.status,
            mappingType: mapping.mappingType,
            assigneeId: mapping.assigneeId,
            assigneeName,
            sourceEntityId: mapping.sourceEntityId,
            sourceFieldId: mapping.sourceFieldId,
            sourceEntityName,
            sourceFieldName,
            transform: mapping.transform,
            defaultValue: mapping.defaultValue,
            confidence: mapping.confidence,
            createdBy: mapping.createdBy,
            editedBy: mapping.editedBy,
            updatedAt: mapping.updatedAt,
            transferId: mapping.transferId ?? null,
          }
        : null,
    });
  }

  // Sort by confidence: high → medium → low → unmapped
  const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  fieldsWithMappings.sort((a, b) => {
    const aOrder = a.mapping?.confidence ? (confidenceOrder[a.mapping.confidence] ?? 3) : 3;
    const bOrder = b.mapping?.confidence ? (confidenceOrder[b.mapping.confidence] ?? 3) : 3;
    return aOrder - bOrder;
  });

  // Build status breakdown from field mappings
  const statusBreakdown: Record<string, number> = {};
  for (const f of fieldsWithMappings) {
    const s = f.mapping?.status || "unmapped";
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  // Stats
  const openQs = (await db
    .select({ cnt: count() })
    .from(question)
    .where(and(eq(question.entityId, id), eq(question.status, "open")))
)[0];

  const mappedCount = statusBreakdown["accepted"] || 0;

  // Auto-derive entity status (preserve manual "blocked" override)
  const computedStatus = deriveEntityStatus(statusBreakdown, fields.length);
  if (ent.status !== "blocked" && ent.status !== computedStatus) {
    await db.update(entity)
      .set({ status: computedStatus, updatedAt: new Date().toISOString() })
      .where(eq(entity.id, id))
      ;
  }

  const effectiveStatus = ent.status === "blocked" ? "blocked" : computedStatus;

  return NextResponse.json({
    ...ent,
    status: effectiveStatus,
    fields: fieldsWithMappings,
    fieldCount: fields.length,
    mappedCount,
    unmappedCount: fields.length - mappedCount,
    coveragePercent:
      fields.length > 0
        ? Math.round((mappedCount / fields.length) * 100)
        : 0,
    openQuestions: openQs?.cnt || 0,
    statusBreakdown,
  });
});

export const PATCH = withAuth(
  async (req, ctx, { workspaceId }) => {
    const { id } = await ctx.params;
    const body = await req.json();
    const parsed = updateEntitySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    // If metadata is provided, merge with existing instead of replacing
    let setData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date().toISOString() };
    if (parsed.data.metadata) {
      const existing = (await db
        .select({ metadata: entity.metadata })
        .from(entity)
        .where(and(eq(entity.id, id), eq(entity.workspaceId, workspaceId)))
      )[0];
      setData.metadata = { ...(existing?.metadata || {}), ...parsed.data.metadata };
    }

    const [updated] = await db
      .update(entity)
      .set(setData)
      .where(and(eq(entity.id, id), eq(entity.workspaceId, workspaceId)))
      .returning()
      ;

    if (!updated) {
      return NextResponse.json(
        { error: "Entity not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  },
  { requiredRole: "editor" }
);
