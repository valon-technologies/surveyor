import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity, validation, workspace } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { logActivity } from "@/lib/activity/log-activity";
import { runValidation, type ValidationInput } from "@/lib/validation/runner";
import type { BigQueryConfig } from "@/types/workspace";

// POST — run validation (uses Gestalt for BigQuery auth)
export const POST = withAuth(async (_req, ctx, { userId, workspaceId }) => {
  const params = await ctx.params;
  const { id } = params;

  const mapping = db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
    .get();

  if (!mapping) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const targetField = db.select().from(field).where(eq(field.id, mapping.targetFieldId)).get();
  const targetEntity = targetField
    ? db.select().from(entity).where(eq(entity.id, targetField.entityId)).get()
    : null;

  let sourceField = null;
  let sourceEntity = null;
  if (mapping.sourceFieldId) {
    sourceField = db.select().from(field).where(eq(field.id, mapping.sourceFieldId)).get();
    if (sourceField) {
      sourceEntity = db.select().from(entity).where(eq(entity.id, sourceField.entityId)).get();
    }
  }

  const input: ValidationInput = {
    entity: targetEntity?.name || "unknown",
    fields: [
      {
        vds_field: targetField?.name || "unknown",
        vds_type: targetField?.dataType || null,
        source: {
          table: sourceEntity?.name || null,
          field: sourceField?.name || null,
          transform: mapping.transform || null,
        },
      },
    ],
  };

  // Load workspace BQ config
  const ws = db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .get();

  const bqConfig = (ws?.settings as Record<string, unknown> | null)?.bigquery as BigQueryConfig | undefined;

  const result = await runValidation(input, bqConfig);

  // Store result
  const [stored] = db
    .insert(validation)
    .values({
      workspaceId,
      fieldMappingId: id,
      entityId: targetField?.entityId || null,
      status: result.status,
      input: input as unknown as Record<string, unknown>,
      output: result.output as unknown as Record<string, unknown>,
      errorMessage: result.errorMessage || null,
      durationMs: result.durationMs,
      ranBy: userId,
    })
    .returning()
    .all();

  logActivity({
    workspaceId,
    fieldMappingId: id,
    entityId: targetField?.entityId || null,
    actorId: userId,
    actorName: mapping.editedBy || "Unknown",
    action: "validation_ran",
    detail: {
      validationStatus: result.status,
      durationMs: result.durationMs,
      errorMessage: result.errorMessage,
    },
  });

  return NextResponse.json(stored);
}, { requiredRole: "editor" });

// GET — get latest validation for this mapping
export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const { id } = params;

  const latest = db
    .select()
    .from(validation)
    .where(and(eq(validation.fieldMappingId, id), eq(validation.workspaceId, workspaceId)))
    .orderBy(desc(validation.createdAt))
    .limit(1)
    .get();

  if (!latest) {
    return NextResponse.json(null);
  }

  return NextResponse.json(latest);
});
