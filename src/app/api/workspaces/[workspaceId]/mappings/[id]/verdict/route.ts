import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { extractVerdictLearning } from "@/lib/generation/mapping-learning";
import { emitFeedbackEvent } from "@/lib/feedback/emit-event";

export const PATCH = withAuth(
  async (req, ctx, { workspaceId }) => {
    const params = await ctx.params;
    const id = params.id;
    const body = (await req.json()) as {
      sourceVerdict?: string;
      sourceVerdictNotes?: string;
      transformVerdict?: string;
      transformVerdictNotes?: string;
    };

    const existing = (await db
      .select({ id: fieldMapping.id })
      .from(fieldMapping)
      .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
)[0];

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, string | null> = {};
    if ("sourceVerdict" in body) updates.sourceVerdict = body.sourceVerdict ?? null;
    if ("sourceVerdictNotes" in body) updates.sourceVerdictNotes = body.sourceVerdictNotes ?? null;
    if ("transformVerdict" in body) updates.transformVerdict = body.transformVerdict ?? null;
    if ("transformVerdictNotes" in body) updates.transformVerdictNotes = body.transformVerdictNotes ?? null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await db.update(fieldMapping)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(fieldMapping.id, id))
      ;

    const sourceVerdict = "sourceVerdict" in body ? body.sourceVerdict : undefined;
    const transformVerdict = "transformVerdict" in body ? body.transformVerdict : undefined;
    const shouldExtract =
      (sourceVerdict && sourceVerdict !== "correct") ||
      (transformVerdict && transformVerdict !== "correct");

    // Look up target field info for event payload
    const mappingDetail = (await db
      .select({
        targetFieldId: fieldMapping.targetFieldId,
        sourceEntityName: entity.name,
      })
      .from(fieldMapping)
      .leftJoin(entity, eq(fieldMapping.sourceEntityId, entity.id))
      .where(eq(fieldMapping.id, id))
      )[0];

    let entityId: string | undefined;
    let targetFieldName: string | undefined;
    if (mappingDetail?.targetFieldId) {
      const targetFieldInfo = (await db
        .select({ name: field.name, entityId: field.entityId })
        .from(field)
        .where(eq(field.id, mappingDetail.targetFieldId))
        )[0];
      entityId = targetFieldInfo?.entityId;
      targetFieldName = targetFieldInfo?.name;
    }

    const correlationId = crypto.randomUUID();

    if (entityId) {
      emitFeedbackEvent({
        workspaceId,
        entityId,
        fieldMappingId: id,
        eventType: "verdict_submitted",
        payload: {
          sourceVerdict: body.sourceVerdict,
          sourceVerdictNotes: body.sourceVerdictNotes,
          transformVerdict: body.transformVerdict,
          transformVerdictNotes: body.transformVerdictNotes,
          fieldName: targetFieldName,
          sourceEntity: mappingDetail?.sourceEntityName,
        },
        correlationId,
      });
    }

    if (shouldExtract) {
      extractVerdictLearning(workspaceId, id, correlationId);
    }

    return NextResponse.json({ success: true });
  },
  { requiredRole: "editor" }
);
