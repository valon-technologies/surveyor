import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db, withTransaction } from "@/lib/db";
import {
  chatSession,
  chatMessage,
  context,
  field,
  entity,
  skill,
  skillContext,
  user,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { buildForgePrompt } from "@/lib/generation/forge-prompt-builder";

const createForgeSessionSchema = z.object({
  entityName: z.string().min(1),
  skillId: z.string().optional(),
});

export const GET = withAuth(async (req, _ctx, { workspaceId }) => {
  const { searchParams } = new URL(req.url);
  const filterEntityName = searchParams.get("entityName");
  const filterSkillId = searchParams.get("skillId");

  // Forge sessions have sessionType = "forge"
  let sessions = await db
    .select({
      id: chatSession.id,
      workspaceId: chatSession.workspaceId,
      fieldMappingId: chatSession.fieldMappingId,
      targetFieldId: chatSession.targetFieldId,
      entityId: chatSession.entityId,
      sessionType: chatSession.sessionType,
      skillId: chatSession.skillId,
      status: chatSession.status,
      messageCount: chatSession.messageCount,
      lastMessageAt: chatSession.lastMessageAt,
      createdBy: chatSession.createdBy,
      createdAt: chatSession.createdAt,
      updatedAt: chatSession.updatedAt,
      createdByName: user.name,
    })
    .from(chatSession)
    .leftJoin(user, eq(chatSession.createdBy, user.id))
    .where(
      and(
        eq(chatSession.workspaceId, workspaceId),
        eq(chatSession.sessionType, "forge")
      )
    )
    .orderBy(desc(chatSession.createdAt))
    ;

  if (filterSkillId) {
    sessions = sessions.filter((s) => s.skillId === filterSkillId);
  }

  if (filterEntityName) {
    // Filter by entity name (need to load entity names)
    const entityNameLower = filterEntityName.toLowerCase();
    const entityIds = sessions.map((s) => s.entityId).filter(Boolean) as string[];
    if (entityIds.length > 0) {
      const entities = await db
        .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
        .from(entity)
        ;
      const entityMap = new Map(entities.map((e) => [e.id, e]));
      sessions = sessions.filter((s) => {
        if (!s.entityId) return false;
        const e = entityMap.get(s.entityId);
        if (!e) return false;
        return (e.displayName || e.name).toLowerCase().includes(entityNameLower);
      });
    }
  }

  return NextResponse.json(sessions);
});

export const POST = withAuth(
  async (req, _ctx, { userId, workspaceId }) => {
    const body = await req.json();
    const parsed = createForgeSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { entityName, skillId } = parsed.data;

    // Find target entity by name
    const targetEntity = (await db
      .select()
      .from(entity)
      .where(
        and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target"))
      )
)
      .find(
        (e) =>
          (e.displayName || e.name).toLowerCase() === entityName.toLowerCase() ||
          e.name.toLowerCase() === entityName.toLowerCase()
      );

    // Build field summary
    let fieldSummary = "No target entity found — the agent will need to discover fields via tools.";
    let entityId: string | null = null;

    if (targetEntity) {
      entityId = targetEntity.id;
      const fields = await db
        .select({
          name: field.name,
          displayName: field.displayName,
          dataType: field.dataType,
          isRequired: field.isRequired,
          description: field.description,
        })
        .from(field)
        .where(eq(field.entityId, targetEntity.id))
        .orderBy(field.sortOrder)
        ;

      const lines = [
        `| Field | Type | Required | Description |`,
        `| ----- | ---- | -------- | ----------- |`,
      ];
      for (const f of fields) {
        const desc = f.description
          ? f.description.length > 80
            ? f.description.slice(0, 80) + "..."
            : f.description
          : "";
        lines.push(
          `| ${f.displayName || f.name} | ${f.dataType || ""} | ${f.isRequired ? "Yes" : "No"} | ${desc} |`
        );
      }
      fieldSummary = `${fields.length} fields:\n\n${lines.join("\n")}`;
    }

    // Context library stats
    const allContexts = await db
      .select({ category: context.category })
      .from(context)
      .where(and(eq(context.workspaceId, workspaceId), eq(context.isActive, true)))
      ;

    const categoryCounts = new Map<string, number>();
    for (const c of allContexts) {
      categoryCounts.set(c.category, (categoryCounts.get(c.category) || 0) + 1);
    }

    const contextLibraryStats = {
      totalContexts: allContexts.length,
      categories: Array.from(categoryCounts.entries()).map(([category, count]) => ({
        category,
        count,
      })),
    };

    // Existing skill info (for refine mode)
    let existingSkillInfo:
      | { id: string; name: string; description: string | null; contextCount: number; totalTokens: number }
      | undefined;

    if (skillId) {
      const [s] = await db.select().from(skill).where(eq(skill.id, skillId)).limit(1);
      if (s) {
        const scs = await db
          .select({
            contextId: skillContext.contextId,
            tokenCount: context.tokenCount,
          })
          .from(skillContext)
          .innerJoin(context, eq(skillContext.contextId, context.id))
          .where(eq(skillContext.skillId, skillId))
          ;

        existingSkillInfo = {
          id: s.id,
          name: s.name,
          description: s.description,
          contextCount: scs.length,
          totalTokens: scs.reduce((sum, sc) => sum + (sc.tokenCount || 0), 0),
        };
      }
    }

    // BigQuery config
    let bigqueryAvailable = false;
    let bigqueryDataset: string | undefined;
    try {
      const { workspace } = await import("@/lib/db/schema");
      const wsRow = (await db
        .select({ settings: workspace.settings })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        )[0];
      const wsSettings = wsRow?.settings as Record<string, unknown> | null;
      const bqConfig = wsSettings?.bigquery as {
        projectId: string;
        sourceDataset: string;
      } | undefined;
      if (bqConfig) {
        bigqueryAvailable = true;
        bigqueryDataset = `${bqConfig.projectId}.${bqConfig.sourceDataset}`;
      }
    } catch {
      // Non-critical
    }

    // Build the forge system prompt
    const { systemMessage } = buildForgePrompt({
      entityName,
      fieldSummary,
      contextLibraryStats,
      existingSkill: existingSkillInfo,
      bigqueryAvailable,
      bigqueryDataset,
    });

    // Create session + initial system message atomically
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const session = await withTransaction(async () => {
      await db.insert(chatSession)
        .values({
          id: sessionId,
          workspaceId,
          fieldMappingId: null,
          targetFieldId: null,
          entityId,
          sessionType: "forge",
          skillId: skillId || null,
          status: "active",
          messageCount: 1,
          lastMessageAt: now,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        ;

      await db.insert(chatMessage)
        .values({
          sessionId,
          role: "system",
          content: systemMessage,
          createdAt: now,
        })
        ;

      return (await db
        .select()
        .from(chatSession)
        .where(eq(chatSession.id, sessionId))
        )[0];
    });

    return NextResponse.json(session);
  },
  { requiredRole: "editor" }
);
