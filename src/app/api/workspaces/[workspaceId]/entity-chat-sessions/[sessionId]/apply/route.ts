import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import {
  chatSession,
  fieldMapping,
  field,
  entity,
  entityPipeline,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { extractMappingLearning } from "@/lib/generation/mapping-learning";
import { createMappingVersion } from "@/lib/db/copy-on-write";
import { MAPPING_TYPES, CONFIDENCE_LEVELS } from "@/lib/constants";

const updateItemSchema = z.object({
  targetFieldName: z.string().min(1),
  mappingType: z.enum(MAPPING_TYPES).nullable().optional(),
  sourceEntityName: z.string().nullable().optional(),
  sourceFieldName: z.string().nullable().optional(),
  transform: z.string().nullable().optional(),
  defaultValue: z.string().nullable().optional(),
  enumMapping: z.record(z.string(), z.string()).nullable().optional(),
  reasoning: z.string().nullable().optional(),
  confidence: z.enum(CONFIDENCE_LEVELS).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const applySchema = z.object({
  updates: z.array(updateItemSchema).min(1),
});

function matchName(a: string, b: string): boolean {
  return (
    a.toLowerCase().replace(/[_\s-]/g, "") ===
    b.toLowerCase().replace(/[_\s-]/g, "")
  );
}

export const POST = withAuth(
  async (req, ctx, { userId, workspaceId }) => {
    const params = await ctx.params;
    const sessionId = params.sessionId;

    // Verify session
    const session = (await db
      .select()
      .from(chatSession)
      .where(
        and(
          eq(chatSession.id, sessionId),
          eq(chatSession.workspaceId, workspaceId)
        )
      )
      )[0];

    if (!session || !session.entityId) {
      return NextResponse.json(
        { error: "Entity chat session not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = applySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { updates } = parsed.data;

    // Load all target fields for this entity
    const targetFields = await db
      .select()
      .from(field)
      .where(eq(field.entityId, session.entityId))
      ;

    // Load source entities + fields for name resolution
    const sourceEntities = await db
      .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
      .from(entity)
      .where(
        and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source"))
      )
      ;

    const sourceEntityIds = sourceEntities.map((e) => e.id);
    const sourceFields =
      sourceEntityIds.length > 0
        ? (await db
            .select({
              id: field.id,
              name: field.name,
              entityId: field.entityId,
            })
            .from(field)
            )
            .filter((f: { entityId: string }) => sourceEntityIds.includes(f.entityId))
        : [];

    const applied: string[] = [];
    const errors: string[] = [];

    for (const update of updates) {
      // Resolve target field by name
      const tf = targetFields.find(
        (f) =>
          matchName(f.name, update.targetFieldName) ||
          (f.displayName && matchName(f.displayName, update.targetFieldName))
      );
      if (!tf) {
        errors.push(
          `Target field "${update.targetFieldName}" not found in entity`
        );
        continue;
      }

      // Find existing latest mapping for this target field
      const existing = (await db
        .select()
        .from(fieldMapping)
        .where(
          and(
            eq(fieldMapping.workspaceId, workspaceId),
            eq(fieldMapping.targetFieldId, tf.id),
            eq(fieldMapping.isLatest, true)
          )
        )
        )[0];

      if (!existing) {
        errors.push(
          `No existing mapping found for "${update.targetFieldName}"`
        );
        continue;
      }

      // Resolve source entity/field names to IDs
      let resolvedSourceEntityId = existing.sourceEntityId;
      let resolvedSourceFieldId = existing.sourceFieldId;

      if (update.sourceEntityName) {
        const match = sourceEntities.find(
          (e) =>
            matchName(e.name, update.sourceEntityName!) ||
            (e.displayName &&
              matchName(e.displayName, update.sourceEntityName!))
        );
        if (match) {
          resolvedSourceEntityId = match.id;
        }
      }

      if (update.sourceFieldName) {
        const candidates = resolvedSourceEntityId
          ? sourceFields.filter((f) => f.entityId === resolvedSourceEntityId)
          : sourceFields;
        const match = candidates.find((f) =>
          matchName(f.name, update.sourceFieldName!)
        );
        if (match) {
          resolvedSourceFieldId = match.id;
          if (!resolvedSourceEntityId) {
            resolvedSourceEntityId = match.entityId;
          }
        }
      }

      // Copy-on-write: atomically mark existing not-latest + insert new version
      const newVersion = await createMappingVersion(existing.id, {
        workspaceId: existing.workspaceId,
        targetFieldId: existing.targetFieldId,
        status: "accepted",
        mappingType:
          update.mappingType !== undefined
            ? update.mappingType
            : existing.mappingType,
        assigneeId: existing.assigneeId,
        sourceEntityId: resolvedSourceEntityId,
        sourceFieldId: resolvedSourceFieldId,
        transform:
          update.transform !== undefined
            ? update.transform
            : existing.transform,
        defaultValue:
          update.defaultValue !== undefined
            ? update.defaultValue
            : existing.defaultValue,
        enumMapping:
          update.enumMapping !== undefined
            ? update.enumMapping
            : existing.enumMapping,
        reasoning:
          update.reasoning !== undefined
            ? update.reasoning
            : existing.reasoning,
        confidence:
          update.confidence !== undefined
            ? update.confidence
            : existing.confidence,
        notes:
          update.notes !== undefined ? update.notes : existing.notes,
        createdBy: existing.createdBy,
        generationId: existing.generationId,
        version: existing.version + 1,
        parentId: existing.id,
        isLatest: true,
        editedBy: "entity-chat",
        changeSummary: `Entity chat bulk update: ${update.reasoning || "no reasoning"}`,
      });

      // Extract learning
      extractMappingLearning(
        {
          sourceEntityId: existing.sourceEntityId,
          sourceFieldId: existing.sourceFieldId,
          mappingType: existing.mappingType,
          transform: existing.transform,
          status: existing.status,
        },
        {
          sourceEntityId: newVersion.sourceEntityId,
          sourceFieldId: newVersion.sourceFieldId,
          mappingType: newVersion.mappingType,
          transform: newVersion.transform,
          status: newVersion.status,
        },
        { workspaceId, targetFieldId: existing.targetFieldId }
      );

      applied.push(update.targetFieldName);
    }

    // Mark entity pipeline as stale
    if (applied.length > 0) {
      await db.update(entityPipeline)
        .set({ isStale: true, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(entityPipeline.entityId, session.entityId),
            eq(entityPipeline.isLatest, true)
          )
        )
        ;
    }

    return NextResponse.json({ applied: applied.length, errors });
  },
  { requiredRole: "editor" }
);
