import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import {
  chatSession,
  skill,
  skillContext,
  context,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";

const skillContextSchema = z.object({
  contextId: z.string(),
  contextName: z.string().optional(),
  role: z.enum(["primary", "reference", "supplementary"]),
  tokenCount: z.number().optional(),
  summary: z.string().optional(),
});

const applySkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  instructions: z.string().optional(),
  applicability: z
    .object({
      entityPatterns: z.array(z.string()).optional(),
      fieldPatterns: z.array(z.string()).optional(),
      dataTypes: z.array(z.string()).optional(),
    })
    .optional(),
  contexts: z.array(skillContextSchema).min(1),
  reasoning: z.string().optional(),
});

export const POST = withAuth(
  async (req, ctx, { workspaceId }) => {
    const params = await ctx.params;
    const sessionId = params.sessionId;

    // Verify forge session exists
    const session = (await db
      .select()
      .from(chatSession)
      .where(
        and(
          eq(chatSession.id, sessionId),
          eq(chatSession.workspaceId, workspaceId),
          eq(chatSession.sessionType, "forge")
        )
      )
      )[0];

    if (!session) {
      return NextResponse.json(
        { error: "Forge session not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = applySkillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { name, description, instructions, applicability, contexts: proposedContexts, reasoning } = parsed.data;

    // Validate all context IDs exist
    const validContextIds = new Set<string>();
    for (const pc of proposedContexts) {
      const ctx = (await db
        .select({ id: context.id })
        .from(context)
        .where(eq(context.id, pc.contextId))
        )[0];
      if (ctx) {
        validContextIds.add(pc.contextId);
      }
    }

    const validProposed = proposedContexts.filter((pc) =>
      validContextIds.has(pc.contextId)
    );

    if (validProposed.length === 0) {
      return NextResponse.json(
        { error: "No valid context IDs in proposal" },
        { status: 400 }
      );
    }

    const existingSkillId = session.skillId;
    const now = new Date().toISOString();

    let result: {
      action: "created" | "updated";
      skillId: string;
      contextsAdded: number;
      contextsRemoved: number;
      contextsUpdated: number;
    };

    if (existingSkillId) {
      // ── Update existing skill ────────────────────────────────────

      // Update skill metadata
      await db.update(skill)
        .set({
          name,
          description: description || null,
          instructions: instructions || null,
          applicability: applicability || null,
          updatedAt: now,
        })
        .where(eq(skill.id, existingSkillId))
        ;

      // Load current context assignments
      const currentScs = await db
        .select()
        .from(skillContext)
        .where(eq(skillContext.skillId, existingSkillId))
        ;

      const currentMap = new Map(
        currentScs.map((sc) => [sc.contextId, sc])
      );
      const proposedMap = new Map(
        validProposed.map((pc) => [pc.contextId, pc])
      );

      // Diff: add, remove, update
      let added = 0;
      let removed = 0;
      let updated = 0;

      // Remove contexts no longer in proposal
      for (const sc of currentScs) {
        if (!proposedMap.has(sc.contextId)) {
          await db.delete(skillContext)
            .where(eq(skillContext.id, sc.id))
            ;
          removed++;
        }
      }

      // Add or update contexts
      for (let i = 0; i < validProposed.length; i++) {
        const pc = validProposed[i];
        const existing = currentMap.get(pc.contextId);

        if (existing) {
          // Update role/notes if changed
          const updates: Record<string, unknown> = { sortOrder: i };
          let changed = existing.sortOrder !== i;
          if (existing.role !== pc.role) {
            updates.role = pc.role;
            changed = true;
          }
          if (pc.summary && existing.notes !== pc.summary) {
            updates.notes = pc.summary;
            changed = true;
          }
          if (changed) {
            await db.update(skillContext)
              .set(updates)
              .where(eq(skillContext.id, existing.id))
              ;
            if (updates.role || updates.notes) updated++;
          }
        } else {
          // Add new context
          await db.insert(skillContext)
            .values({
              skillId: existingSkillId,
              contextId: pc.contextId,
              role: pc.role,
              sortOrder: i,
              notes: pc.summary || null,
              createdAt: now,
            })
            ;
          added++;
        }
      }

      result = {
        action: "updated",
        skillId: existingSkillId,
        contextsAdded: added,
        contextsRemoved: removed,
        contextsUpdated: updated,
      };
    } else {
      // ── Create new skill ─────────────────────────────────────────
      const skillId = crypto.randomUUID();

      await db.insert(skill)
        .values({
          id: skillId,
          workspaceId,
          name,
          description: description || null,
          instructions: instructions || null,
          applicability: applicability || null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        ;

      // Batch insert context assignments
      for (let i = 0; i < validProposed.length; i++) {
        const pc = validProposed[i];
        await db.insert(skillContext)
          .values({
            skillId,
            contextId: pc.contextId,
            role: pc.role,
            sortOrder: i,
            notes: pc.summary || null,
            createdAt: now,
          })
          ;
      }

      // Link session to new skill
      await db.update(chatSession)
        .set({ skillId })
        .where(eq(chatSession.id, sessionId))
        ;

      result = {
        action: "created",
        skillId,
        contextsAdded: validProposed.length,
        contextsRemoved: 0,
        contextsUpdated: 0,
      };
    }

    // Invalidate context cache so assembleContext picks up changes
    invalidateWorkspaceContextCache(workspaceId);

    return NextResponse.json(result);
  },
  { requiredRole: "editor" }
);
