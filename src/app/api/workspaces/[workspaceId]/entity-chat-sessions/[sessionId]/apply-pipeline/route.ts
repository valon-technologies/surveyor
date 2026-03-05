import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { chatSession, entity, field, entityPipeline } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createPipelineVersion } from "@/lib/db/copy-on-write";
import { z } from "zod/v4";

const pipelineUpdateSchema = z.object({
  update: z.object({
    structureType: z.enum(["flat", "assembly"]).optional(),
    addSources: z
      .array(
        z.object({
          name: z.string(),
          alias: z.string(),
          table: z.string(),
          filters: z.array(z.record(z.string(), z.unknown())).optional(),
        })
      )
      .optional(),
    removeSources: z.array(z.string()).optional(),
    addJoins: z
      .array(
        z.object({
          left: z.string(),
          right: z.string(),
          on: z.array(z.string()),
          how: z.string(),
        })
      )
      .optional(),
    removeJoins: z
      .array(z.object({ left: z.string(), right: z.string() }))
      .optional(),
    updateJoins: z
      .array(
        z.object({
          left: z.string(),
          right: z.string(),
          on: z.array(z.string()).optional(),
          how: z.string().optional(),
        })
      )
      .optional(),
    concat: z
      .union([z.object({ sources: z.array(z.string()) }), z.null()])
      .optional(),
    reasoning: z.string().optional().default("Pipeline structure update"),
  }),
});

type PipelineSource = {
  name: string;
  alias: string;
  table: string;
  filters?: Record<string, unknown>[];
};
type PipelineJoin = { left: string; right: string; on: string[]; how: string };

export const POST = withAuth(
  async (req, ctx, { workspaceId }) => {
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

    // Normalize LLM output: the gold-format YAML uses `staging: { table }`,
    // so the LLM sometimes mirrors that instead of the flat `{ table }` we expect.
    if (body?.update?.addSources && Array.isArray(body.update.addSources)) {
      for (const src of body.update.addSources) {
        if (!src.table && src.staging?.table) {
          src.table = src.staging.table;
          delete src.staging;
        }
      }
    }

    const parsed = pipelineUpdateSchema.safeParse(body);
    if (!parsed.success) {
      console.error("[apply-pipeline] Zod validation failed:", JSON.stringify(parsed.error.issues, null, 2));
      console.error("[apply-pipeline] Body received:", JSON.stringify(body, null, 2));
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { update } = parsed.data;

    // Load current latest pipeline
    const current = (await db
      .select()
      .from(entityPipeline)
      .where(
        and(
          eq(entityPipeline.entityId, session.entityId),
          eq(entityPipeline.isLatest, true)
        )
      )
      )[0];

    if (!current) {
      return NextResponse.json(
        { error: "No pipeline found for this entity" },
        { status: 404 }
      );
    }

    // Apply the diff
    const changes: string[] = [];
    let newSources: PipelineSource[] = [...(current.sources || [])];
    let newJoins: PipelineJoin[] | null = current.joins
      ? [...current.joins]
      : null;
    let newConcat = current.concat;
    let newStructureType = current.structureType;

    // structureType
    if (update.structureType && update.structureType !== current.structureType) {
      changes.push(
        `Structure: ${current.structureType} -> ${update.structureType}`
      );
      newStructureType = update.structureType;
    }

    // addSources — track which ones are truly new for child entity creation
    const addedSources: PipelineSource[] = [];
    if (update.addSources) {
      for (const src of update.addSources) {
        const exists = newSources.some((s) => s.alias === src.alias);
        if (!exists) {
          newSources.push(src);
          addedSources.push(src);
          changes.push(`Add source: ${src.name} as ${src.alias}`);
        }
      }
    }

    // removeSources
    if (update.removeSources) {
      for (const alias of update.removeSources) {
        const before = newSources.length;
        newSources = newSources.filter((s) => s.alias !== alias);
        if (newSources.length < before) {
          changes.push(`Remove source: ${alias}`);
          // Also remove joins referencing this alias
          if (newJoins) {
            newJoins = newJoins.filter(
              (j) => j.left !== alias && j.right !== alias
            );
          }
        }
      }
    }

    // addJoins
    if (update.addJoins) {
      if (!newJoins) newJoins = [];
      for (const join of update.addJoins) {
        const exists = newJoins.some(
          (j) => j.left === join.left && j.right === join.right
        );
        if (!exists) {
          newJoins.push(join);
          changes.push(
            `Add join: ${join.left} ${join.how.toUpperCase()} JOIN ${join.right} ON ${join.on.join(", ")}`
          );
        }
      }
    }

    // removeJoins
    if (update.removeJoins && newJoins) {
      for (const target of update.removeJoins) {
        const before = newJoins.length;
        newJoins = newJoins.filter(
          (j) => !(j.left === target.left && j.right === target.right)
        );
        if (newJoins.length < before) {
          changes.push(`Remove join: ${target.left} <-> ${target.right}`);
        }
      }
    }

    // updateJoins
    if (update.updateJoins && newJoins) {
      for (const upd of update.updateJoins) {
        const existing = newJoins.find(
          (j) => j.left === upd.left && j.right === upd.right
        );
        if (existing) {
          if (upd.on) existing.on = upd.on;
          if (upd.how) existing.how = upd.how;
          changes.push(`Update join: ${upd.left} <-> ${upd.right}`);
        }
      }
    }

    // concat
    if (update.concat !== undefined) {
      if (update.concat === null) {
        if (newConcat) {
          changes.push("Remove concat configuration");
          newConcat = null;
        }
      } else {
        changes.push(
          `Set concat: ${update.concat.sources.join(", ")}`
        );
        newConcat = update.concat;
      }
    }

    if (changes.length === 0) {
      return NextResponse.json({ success: true, changes: [] });
    }

    const now = new Date().toISOString();

    // Atomic copy-on-write: mark current not-latest + insert new version
    createPipelineVersion(current.id, {
      workspaceId: current.workspaceId,
      entityId: current.entityId,
      version: current.version + 1,
      parentId: current.id,
      isLatest: true,
      yamlSpec: current.yamlSpec, // will be rebuilt on next GET due to isStale
      tableName: current.tableName,
      primaryKey: current.primaryKey,
      sources: newSources,
      joins: newJoins,
      concat: newConcat,
      structureType: newStructureType,
      isStale: true,
      generationId: current.generationId,
      batchRunId: current.batchRunId,
      editedBy: "entity-chat",
      changeSummary: update.reasoning,
      createdAt: now,
      updatedAt: now,
    });

    // Auto-create child component entities for newly added assembly sources
    const createdEntities: string[] = [];
    if (
      newStructureType === "assembly" &&
      addedSources.length > 0
    ) {
      // Load parent entity for schemaAssetId and fields
      const parentEntity = (await db
        .select()
        .from(entity)
        .where(eq(entity.id, session.entityId))
        )[0];

      if (parentEntity) {
        const parentFields = await db
          .select()
          .from(field)
          .where(eq(field.entityId, session.entityId))
          ;

        for (const src of addedSources) {
          // Skip if child entity already exists
          const existing = (await db
            .select()
            .from(entity)
            .where(
              and(
                eq(entity.workspaceId, workspaceId),
                eq(entity.name, src.name)
              )
            )
            )[0];

          if (existing) continue;

          const compEntityId = crypto.randomUUID();
          const displayName = src.name
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

          // Create child entity
          await db.insert(entity)
            .values({
              id: compEntityId,
              workspaceId,
              schemaAssetId: parentEntity.schemaAssetId,
              name: src.name,
              displayName,
              side: "target",
              description: `Component of ${parentEntity.name}: ${src.name}`,
              parentEntityId: session.entityId,
              createdAt: now,
              updatedAt: now,
            })
            ;

          // Clone fields from parent
          for (const pf of parentFields) {
            await db.insert(field)
              .values({
                entityId: compEntityId,
                name: pf.name,
                dataType: pf.dataType,
                isRequired: pf.isRequired,
                isKey: pf.isKey,
                description: pf.description,
                enumValues: pf.enumValues,
                sampleValues: pf.sampleValues,
                sortOrder: pf.sortOrder,
              })
              ;
          }

          // Create stub flat pipeline
          await db.insert(entityPipeline)
            .values({
              workspaceId,
              entityId: compEntityId,
              version: 1,
              isLatest: true,
              yamlSpec: "",
              tableName: src.table,
              sources: [{ name: src.name, alias: src.alias, table: src.table }],
              joins: null,
              concat: null,
              structureType: "flat",
              isStale: true,
              editedBy: "entity-chat",
              changeSummary: `Auto-created from assembly source "${src.name}"`,
              createdAt: now,
              updatedAt: now,
            })
            ;

          createdEntities.push(src.name);
          changes.push(`Created child entity: ${src.name}`);
        }

        if (createdEntities.length > 0) {
          console.log(
            `[apply-pipeline] Created ${createdEntities.length} child entities: ${createdEntities.join(", ")}`
          );
        }
      }
    }

    return NextResponse.json({ success: true, changes, createdEntities });
  },
  { requiredRole: "editor" }
);
