import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import {
  entityPipeline,
  fieldMapping,
  field,
  entity as entityTable,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { rebuildPipelineYaml } from "@/lib/generation/yaml-rebuilder";
import { synthesizePipelineFromMappings } from "@/lib/generation/pipeline-synthesizer";
import yaml from "js-yaml";

export const GET = withAuth(async (req, ctx, { userId, workspaceId }) => {
  const params = await ctx.params;
  const entityId = params.id;

  // Get the latest pipeline for this entity
  let pipeline = db
    .select()
    .from(entityPipeline)
    .where(
      and(
        eq(entityPipeline.entityId, entityId),
        eq(entityPipeline.workspaceId, workspaceId),
        eq(entityPipeline.isLatest, true)
      )
    )
    .get();

  // If no pipeline exists, try to synthesize one from field mappings
  if (!pipeline) {
    const targetEntity = db
      .select()
      .from(entityTable)
      .where(eq(entityTable.id, entityId))
      .get();

    if (!targetEntity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Check if there are any field mappings for this entity
    const fieldIds = db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, entityId))
      .all()
      .map((f) => f.id);

    const hasMappings = fieldIds.length > 0 && db
      .select({ id: fieldMapping.id, targetFieldId: fieldMapping.targetFieldId })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true)
        )
      )
      .all()
      .some((m) => fieldIds.includes(m.targetFieldId));

    if (hasMappings) {
      try {
        synthesizePipelineFromMappings({
          workspaceId,
          entityId,
          entityName: targetEntity.displayName || targetEntity.name,
        });

        pipeline = db
          .select()
          .from(entityPipeline)
          .where(
            and(
              eq(entityPipeline.entityId, entityId),
              eq(entityPipeline.workspaceId, workspaceId),
              eq(entityPipeline.isLatest, true)
            )
          )
          .get();
      } catch (err) {
        console.warn("[pipeline] Auto-synthesis failed:", err);
      }
    }

    if (!pipeline) {
      return NextResponse.json({ error: "No pipeline found for this entity" }, { status: 404 });
    }
  }

  // If stale, rebuild before returning
  if (pipeline.isStale) {
    try {
      rebuildPipelineYaml(pipeline.id);
      // Re-read the updated record
      const updated = db
        .select()
        .from(entityPipeline)
        .where(eq(entityPipeline.id, pipeline.id))
        .get();

      if (updated) {
        const columns = parseColumnsFromYaml(updated.yamlSpec);
        return NextResponse.json({ ...updated, columns });
      }
    } catch (err) {
      console.warn("[pipeline] Rebuild failed, returning stale pipeline:", err);
    }
  }

  const columns = parseColumnsFromYaml(pipeline.yamlSpec);
  return NextResponse.json({ ...pipeline, columns });
});

function parseColumnsFromYaml(yamlSpec: string): unknown[] {
  try {
    const parsed = yaml.load(yamlSpec) as Record<string, unknown>;
    return (parsed?.columns as unknown[]) ?? [];
  } catch {
    return [];
  }
}
