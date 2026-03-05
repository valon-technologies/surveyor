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
  let pipeline = (await db
    .select()
    .from(entityPipeline)
    .where(
      and(
        eq(entityPipeline.entityId, entityId),
        eq(entityPipeline.workspaceId, workspaceId),
        eq(entityPipeline.isLatest, true)
      )
    )
    )[0];

  // If no pipeline exists, try to synthesize one from field mappings
  if (!pipeline) {
    const targetEntity = (await db
      .select()
      .from(entityTable)
      .where(eq(entityTable.id, entityId))
      )[0];

    if (!targetEntity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Check if there are any field mappings for this entity
    const fieldIds = (await db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, entityId))
)
      .map((f) => f.id);

    const hasMappings = fieldIds.length > 0 && (await db
      .select({ id: fieldMapping.id, targetFieldId: fieldMapping.targetFieldId })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.isLatest, true)
        )
      )
      )
      .some((m: { targetFieldId: string }) => fieldIds.includes(m.targetFieldId));

    if (hasMappings) {
      try {
        await synthesizePipelineFromMappings({
          workspaceId,
          entityId,
          entityName: targetEntity.displayName || targetEntity.name,
        });

        pipeline = (await db
          .select()
          .from(entityPipeline)
          .where(
            and(
              eq(entityPipeline.entityId, entityId),
              eq(entityPipeline.workspaceId, workspaceId),
              eq(entityPipeline.isLatest, true)
            )
          )
          )[0];
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
      const updated = (await db
        .select()
        .from(entityPipeline)
        .where(eq(entityPipeline.id, pipeline.id))
        )[0];

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
