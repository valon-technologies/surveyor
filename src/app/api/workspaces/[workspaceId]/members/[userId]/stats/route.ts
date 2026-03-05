import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity, question, chatSession, user, userWorkspace } from "@/lib/db/schema";
import { eq, and, inArray, sql, count } from "drizzle-orm";
import { ENTITY_DOMAIN_MAP, FIELD_DOMAINS, type FieldDomain } from "@/lib/constants";

export interface DomainStat {
  domain: FieldDomain;
  reviewed: number;
  acceptanceRate: number;
}

export interface UserStats {
  userId: string;
  name: string | null;
  totalReviewed: number;
  totalQuestionsAnswered: number;
  totalChatSessions: number;
  domainStats: DomainStat[];
  strengths: FieldDomain[];
  rank: number;
}

export const GET = withAuth(
  async (_req, ctx, { userId: currentUserId, workspaceId, role }) => {
    const params = await ctx.params;
    const targetUserId = params.userId;

    // Access control: self or admin
    if (targetUserId !== currentUserId && role !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify user is in workspace
    const [membership] = await db
      .select({ role: userWorkspace.role })
      .from(userWorkspace)
      .where(
        and(
          eq(userWorkspace.userId, targetUserId),
          eq(userWorkspace.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const [targetUser] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, targetUserId))
      .limit(1);

    // Get all finalized mappings by this user (accepted or excluded, latest version)
    const userMappings = await db
      .select({
        id: fieldMapping.id,
        status: fieldMapping.status,
        targetFieldId: fieldMapping.targetFieldId,
        isLatest: fieldMapping.isLatest,
      })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.assigneeId, targetUserId),
          inArray(fieldMapping.status, ["accepted", "excluded"]),
        ),
      );

    const totalReviewed = userMappings.length;

    // Count how many are still the latest version (not overwritten by someone else)
    const stillLatest = userMappings.filter((m) => m.isLatest).length;

    // Questions answered
    const [qCount] = await db
      .select({ count: count() })
      .from(question)
      .where(
        and(
          eq(question.workspaceId, workspaceId),
          eq(question.status, "resolved"),
          eq(question.resolvedBy, targetUserId),
        ),
      );

    // Chat sessions
    const [csCount] = await db
      .select({ count: count() })
      .from(chatSession)
      .where(
        and(
          eq(chatSession.workspaceId, workspaceId),
          eq(chatSession.createdBy, targetUserId),
        ),
      );

    // Build domain stats: resolve each mapping's domain from its target field's entity
    const targetFieldIds = [...new Set(userMappings.map((m) => m.targetFieldId))];

    // Build field → entity → domain lookup
    const fieldDomainMap = new Map<string, FieldDomain | null>();

    if (targetFieldIds.length > 0) {
      // Batch in chunks of 500 to avoid query limits
      for (let i = 0; i < targetFieldIds.length; i += 500) {
        const chunk = targetFieldIds.slice(i, i + 500);
        const rows = await db
          .select({
            fieldId: field.id,
            entityName: entity.name,
            domainTag: field.domainTag,
          })
          .from(field)
          .innerJoin(entity, eq(field.entityId, entity.id))
          .where(inArray(field.id, chunk));

        for (const r of rows) {
          const domain: FieldDomain | null =
            (r.domainTag as FieldDomain) ??
            ENTITY_DOMAIN_MAP[r.entityName]?.[0] ??
            null;
          fieldDomainMap.set(r.fieldId, domain);
        }
      }
    }

    // Aggregate per domain
    const domainCounts = new Map<FieldDomain, { reviewed: number; stillLatest: number }>();

    for (const m of userMappings) {
      const domain = fieldDomainMap.get(m.targetFieldId);
      if (!domain) continue;
      const cur = domainCounts.get(domain) || { reviewed: 0, stillLatest: 0 };
      cur.reviewed++;
      if (m.isLatest) cur.stillLatest++;
      domainCounts.set(domain, cur);
    }

    const domainStats: DomainStat[] = FIELD_DOMAINS
      .map((d) => {
        const s = domainCounts.get(d);
        if (!s || s.reviewed === 0) return { domain: d, reviewed: 0, acceptanceRate: 0 };
        return {
          domain: d,
          reviewed: s.reviewed,
          acceptanceRate: Math.round((s.stillLatest / s.reviewed) * 100),
        };
      })
      .filter((d) => d.reviewed > 0)
      .sort((a, b) => b.reviewed - a.reviewed);

    // Strengths: top domains by volume where acceptance > 80%
    const strengths = domainStats
      .filter((d) => d.acceptanceRate >= 80 && d.reviewed >= 5)
      .slice(0, 2)
      .map((d) => d.domain);

    // Rank: position among all editors by total reviewed count
    const allEditorCounts = await db
      .select({
        assigneeId: fieldMapping.assigneeId,
        count: count(),
      })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          inArray(fieldMapping.status, ["accepted", "excluded"]),
          sql`${fieldMapping.assigneeId} IS NOT NULL`,
        ),
      )
      .groupBy(fieldMapping.assigneeId)
      .orderBy(sql`count(*) DESC`);

    const rank = allEditorCounts.findIndex((r) => r.assigneeId === targetUserId) + 1;

    const stats: UserStats = {
      userId: targetUserId,
      name: targetUser?.name ?? null,
      totalReviewed,
      totalQuestionsAnswered: Number(qCount?.count ?? 0),
      totalChatSessions: Number(csCount?.count ?? 0),
      domainStats,
      strengths,
      rank: rank || allEditorCounts.length + 1,
    };

    return NextResponse.json(stats);
  },
);
