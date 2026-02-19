import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { chatSession, entityPipeline } from "@/lib/db/schema";
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
    reasoning: z.string(),
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
    const session = db
      .select()
      .from(chatSession)
      .where(
        and(
          eq(chatSession.id, sessionId),
          eq(chatSession.workspaceId, workspaceId)
        )
      )
      .get();

    if (!session || !session.entityId) {
      return NextResponse.json(
        { error: "Entity chat session not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = pipelineUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { update } = parsed.data;

    // Load current latest pipeline
    const current = db
      .select()
      .from(entityPipeline)
      .where(
        and(
          eq(entityPipeline.entityId, session.entityId),
          eq(entityPipeline.isLatest, true)
        )
      )
      .get();

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

    // addSources
    if (update.addSources) {
      for (const src of update.addSources) {
        const exists = newSources.some((s) => s.alias === src.alias);
        if (!exists) {
          newSources.push(src);
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

    return NextResponse.json({ success: true, changes });
  },
  { requiredRole: "editor" }
);
