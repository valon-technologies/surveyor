import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity, validation, workspace, userBigqueryToken } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { logActivity } from "@/lib/activity/log-activity";
import { runValidation, type ValidationInput } from "@/lib/validation/runner";
import { decrypt } from "@/lib/auth/encryption";
import type { BigQueryConfig, BigQueryCredentials } from "@/types/workspace";

// POST — run validation
export const POST = withAuth(async (_req, ctx, { userId, workspaceId }) => {
  const params = await ctx.params;
  const { id } = params;

  const mapping = (await db
    .select()
    .from(fieldMapping)
    .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId))))[0];

  if (!mapping) {
    return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  }

  const targetField = (await db.select().from(field).where(eq(field.id, mapping.targetFieldId)))[0];
  const targetEntity = targetField
    ? (await db.select().from(entity).where(eq(entity.id, targetField.entityId)))[0]
    : null;

  let sourceField = null;
  let sourceEntity = null;
  if (mapping.sourceFieldId) {
    sourceField = (await db.select().from(field).where(eq(field.id, mapping.sourceFieldId)))[0];
    if (sourceField) {
      sourceEntity = (await db.select().from(entity).where(eq(entity.id, sourceField.entityId)))[0];
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
  const ws = (await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId)))[0];

  const bqConfig = (ws?.settings as Record<string, unknown> | null)?.bigquery as BigQueryConfig | undefined;

  // Load user's BQ OAuth credentials
  let credentials: BigQueryCredentials | null = null;
  const bqToken = (await db
    .select()
    .from(userBigqueryToken)
    .where(eq(userBigqueryToken.userId, userId)))[0];

  if (bqToken) {
    credentials = {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      refreshToken: decrypt(bqToken.encryptedRefreshToken, bqToken.iv, bqToken.authTag),
    };
  } else if (bqConfig && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // BQ is configured but user hasn't connected their Google account and no ADC
    const notConnectedResult = {
      status: "error" as const,
      output: null,
      errorMessage: "BigQuery not connected. Go to Settings > BigQuery and click \"Connect BigQuery\" to authenticate.",
      durationMs: 0,
    };

    const [stored] = await db
      .insert(validation)
      .values({
        workspaceId,
        fieldMappingId: id,
        entityId: targetField?.entityId || null,
        status: notConnectedResult.status,
        input: input as unknown as Record<string, unknown>,
        output: null,
        errorMessage: notConnectedResult.errorMessage,
        durationMs: 0,
        ranBy: userId,
      })
      .returning();

    return NextResponse.json(stored);
  }

  const result = await runValidation(input, bqConfig, credentials);

  // Store result
  const [stored] = await db
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
    .returning();

  await logActivity({
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

  const latest = (await db
    .select()
    .from(validation)
    .where(and(eq(validation.fieldMappingId, id), eq(validation.workspaceId, workspaceId)))
    .orderBy(desc(validation.createdAt))
    .limit(1))[0];

  if (!latest) {
    return NextResponse.json(null);
  }

  return NextResponse.json(latest);
});
