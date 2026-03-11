import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import {
  entity,
  field,
  fieldMapping,
  question,
  user,
  chatSession,
  evaluation,
} from "@/lib/db/schema";
import { eq, and, sql, count, notInArray, inArray, isNull } from "drizzle-orm";
import { MILESTONES, ENTITY_DOMAIN_MAP, FIELD_DOMAINS, type FieldDomain } from "@/lib/constants";
import type {
  LeaderboardEntry,
  AssignedFieldItem,
  MyQuestionItem,
} from "@/types/dashboard";

export const GET = withAuth(async (req, ctx, { workspaceId, userId }) => {
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab");
  const milestone = url.searchParams.get("milestone");

  // ─── My Work Tab ──────────────────────────────────────────
  if (tab === "my-work") {
    // Assigned fields: latest mappings assigned to current user, not yet closed
    const assignedFields: AssignedFieldItem[] = await db
      .select({
        fieldMappingId: fieldMapping.id,
        targetFieldId: fieldMapping.targetFieldId,
        targetFieldName: field.name,
        targetFieldDescription: field.description,
        entityId: entity.id,
        entityName: sql<string>`COALESCE(${entity.displayName}, ${entity.name})`,
        status: fieldMapping.status,
        confidence: fieldMapping.confidence,
        mappingType: fieldMapping.mappingType,
        puntNote: fieldMapping.puntNote,
        updatedAt: fieldMapping.updatedAt,
      })
      .from(fieldMapping)
      .innerJoin(field, eq(field.id, fieldMapping.targetFieldId))
      .innerJoin(entity, eq(entity.id, field.entityId))
      .where(
        and(
          eq(fieldMapping.workspaceId, workspaceId),
          eq(fieldMapping.assigneeId, userId),
          eq(fieldMapping.isLatest, true),
          notInArray(fieldMapping.status, ["accepted", "excluded"]),
          isNull(fieldMapping.transferId)
        )
      )
      .orderBy(entity.sortOrder, field.sortOrder)
      ;

    // My questions: open questions I created or am assigned to
    const allOpenQuestions = await db
      .select({
        id: question.id,
        question: question.question,
        status: question.status,
        priority: question.priority,
        entityId: question.entityId,
        entityName: entity.displayName,
        entityNameFallback: entity.name,
        fieldId: question.fieldId,
        assigneeIds: question.assigneeIds,
        createdByUserId: question.createdByUserId,
        replyCount: question.replyCount,
        createdAt: question.createdAt,
      })
      .from(question)
      .leftJoin(entity, eq(entity.id, question.entityId))
      .where(
        and(
          eq(question.workspaceId, workspaceId),
          eq(question.status, "open")
        )
      )
      .orderBy(
        sql`CASE ${question.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END`,
        question.createdAt
      )
      ;

    // Filter to questions the user created or is assigned to
    const myQuestions: MyQuestionItem[] = [];
    for (const q of allOpenQuestions) {
      const assigneeIds = q.assigneeIds ?? [];
      const isAssigned = assigneeIds.includes(userId);
      const isCreated = q.createdByUserId === userId;
      if (!isAssigned && !isCreated) continue;

      // Look up field name if fieldId exists
      let fieldName: string | null = null;
      if (q.fieldId) {
        const f = (await db
          .select({ name: field.name })
          .from(field)
          .where(eq(field.id, q.fieldId))
          )[0];
        fieldName = f?.name ?? null;
      }

      myQuestions.push({
        id: q.id,
        question: q.question,
        status: q.status,
        priority: q.priority,
        entityId: q.entityId,
        entityName: q.entityName ?? q.entityNameFallback ?? null,
        fieldName,
        replyCount: q.replyCount,
        createdAt: q.createdAt,
        relationship: isAssigned ? "assigned" : "created",
      });
    }

    return NextResponse.json({ assignedFields, myQuestions });
  }

  // ─── Overview Tab (default) ───────────────────────────────

  // Get all target entities with field counts and mapping stats
  const entities = await db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .orderBy(entity.sortOrder)
    ;

  // Identify assembly parent entities (those that have child entities)
  // Assembly parents don't have direct field mappings — stats derive from children
  const assemblyParentIds = new Set<string>();
  for (const e of entities) {
    if (e.parentEntityId) {
      assemblyParentIds.add(e.parentEntityId);
    }
  }

  // Get field counts and mapping stats per entity
  const entityStats = await Promise.all(entities.map(async (e) => {
    // Assembly parents: zero out field stats (component aggregates from children)
    if (assemblyParentIds.has(e.id)) {
      const openQs = (await db
        .select({ cnt: count() })
        .from(question)
        .where(and(eq(question.entityId, e.id), eq(question.status, "open")))
        )[0];
      return {
        id: e.id,
        name: e.name,
        displayName: e.displayName,
        parentEntityId: e.parentEntityId ?? null,
        status: e.status,
        fieldCount: 0,
        mappedCount: 0,
        unmappedCount: 0,
        coveragePercent: 0,
        openQuestions: openQs?.cnt || 0,
        statusBreakdown: {} as Record<string, number>,
      };
    }

    const fields = await db
      .select({ id: field.id })
      .from(field)
      .where(
        milestone
          ? and(eq(field.entityId, e.id), eq(field.milestone, milestone))
          : eq(field.entityId, e.id)
      )
      ;

    const fieldIds = fields.map((f) => f.id);
    const statusCounts: Record<string, number> = {};

    if (fieldIds.length > 0) {
      const mappings = await db
        .select({
          status: sql<string>`COALESCE(${fieldMapping.status}, 'unmapped')`,
          cnt: sql<number>`COUNT(DISTINCT ${field.id})`,
        })
        .from(field)
        .leftJoin(
          fieldMapping,
          and(
            eq(fieldMapping.targetFieldId, field.id),
            eq(fieldMapping.isLatest, true),
            isNull(fieldMapping.transferId)
          )
        )
        .where(
          sql`${field.id} IN (${sql.join(
            fieldIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )
        .groupBy(sql`COALESCE(${fieldMapping.status}, 'unmapped')`)
        ;

      for (const m of mappings) {
        statusCounts[m.status] = m.cnt;
      }
    }

    const mappedCount = (statusCounts["accepted"] || 0) + (statusCounts["excluded"] || 0);

    const openQs = (await db
      .select({ cnt: count() })
      .from(question)
      .where(and(eq(question.entityId, e.id), eq(question.status, "open")))
      )[0];

    return {
      id: e.id,
      name: e.name,
      displayName: e.displayName,
      parentEntityId: e.parentEntityId ?? null,
      status: e.status,
      fieldCount: fields.length,
      mappedCount,
      unmappedCount: fields.length - mappedCount,
      coveragePercent:
        fields.length > 0
          ? parseFloat(((mappedCount / fields.length) * 100).toFixed(2))
          : 0,
      openQuestions: openQs?.cnt || 0,
      statusBreakdown: statusCounts,
    };
  }));

  // Milestone stats
  const milestoneStats = await Promise.all(MILESTONES.map(async (m) => {
    // Subquery: pick one status per field (avoids inflation from multiple mapping versions)
    const excludeClause = assemblyParentIds.size > 0
      ? sql`AND e.id NOT IN (${sql.join([...assemblyParentIds].map(id => sql`${id}`), sql`, `)})`
      : sql``;
    const rows = await db.execute(sql`
      SELECT status, COUNT(*) as cnt FROM (
        SELECT DISTINCT ON (f.id)
          f.id,
          COALESCE(fm.status, 'unmapped') as status
        FROM field f
        JOIN entity e ON e.id = f.entity_id AND e.side = 'target' AND e.workspace_id = ${workspaceId}
        LEFT JOIN field_mapping fm ON fm.target_field_id = f.id AND fm.is_latest = true AND fm.transfer_id IS NULL
        WHERE f.milestone = ${m} ${excludeClause}
        ORDER BY f.id, fm.updated_at DESC NULLS LAST
      ) sub
      GROUP BY status
    `) as { status: string; cnt: string }[];

    const statusBreakdown: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const count = parseInt(String(r.cnt), 10);
      statusBreakdown[r.status] = count;
      total += count;
    }

    const mapped = (statusBreakdown["accepted"] || 0) + (statusBreakdown["excluded"] || 0);

    return {
      milestone: m,
      totalFields: total,
      mappedFields: mapped,
      coveragePercent: total > 0 ? parseFloat(((mapped / total) * 100).toFixed(2)) : 0,
      statusBreakdown,
    };
  }));

  // Aggregate stats
  const totalFields = entityStats.reduce((sum, e) => sum + e.fieldCount, 0);
  const mappedFields = entityStats.reduce((sum, e) => sum + e.mappedCount, 0);

  // Status distribution (same DISTINCT ON approach to avoid inflation)
  const excludeParentsClause = assemblyParentIds.size > 0
    ? sql`AND e.id NOT IN (${sql.join([...assemblyParentIds].map(id => sql`${id}`), sql`, `)})`
    : sql``;
  const milestoneClause = milestone ? sql`AND f.milestone = ${milestone}` : sql``;
  const allFieldStatuses = await db.execute(sql`
    SELECT status, COUNT(*) as cnt FROM (
      SELECT DISTINCT ON (f.id)
        f.id,
        COALESCE(fm.status, 'unmapped') as status
      FROM field f
      JOIN entity e ON e.id = f.entity_id AND e.side = 'target' AND e.workspace_id = ${workspaceId}
      LEFT JOIN field_mapping fm ON fm.target_field_id = f.id AND fm.is_latest = true AND fm.transfer_id IS NULL
      WHERE true ${excludeParentsClause} ${milestoneClause}
      ORDER BY f.id, fm.updated_at DESC NULLS LAST
    ) sub
    GROUP BY status
  `) as { status: string; cnt: string }[];

  const statusDistribution: Record<string, number> = {};
  for (const r of allFieldStatuses) {
    statusDistribution[r.status] = parseInt(String(r.cnt), 10);
  }

  const openQuestions = (await db
    .select({ cnt: count() })
    .from(question)
    .where(
      and(eq(question.workspaceId, workspaceId), eq(question.status, "open"))
    )
    )[0];

  // ─── Leaderboard Queries ────────────────────────────────────

  // Most Mapped: accepted + isLatest, grouped by assigneeId
  const mostMapped = await db
    .select({
      userId: fieldMapping.assigneeId,
      name: user.name,
      image: user.image,
      count: count(),
    })
    .from(fieldMapping)
    .innerJoin(user, eq(user.id, fieldMapping.assigneeId))
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        inArray(fieldMapping.status, ["accepted", "excluded"]),
        eq(fieldMapping.isLatest, true),
        sql`${fieldMapping.assigneeId} IS NOT NULL`,
        isNull(fieldMapping.transferId)
      )
    )
    .groupBy(fieldMapping.assigneeId, user.name, user.image)
    .orderBy(sql`count(*) DESC`)
    .limit(10) as LeaderboardEntry[];

  // Most Questions Answered: resolved questions grouped by resolvedBy
  const mostQuestionsAnswered = await db
    .select({
      userId: question.resolvedBy,
      name: user.name,
      image: user.image,
      count: count(),
    })
    .from(question)
    .innerJoin(user, eq(user.id, question.resolvedBy))
    .where(
      and(
        eq(question.workspaceId, workspaceId),
        eq(question.status, "resolved"),
        sql`${question.resolvedBy} IS NOT NULL`
      )
    )
    .groupBy(question.resolvedBy, user.name, user.image)
    .orderBy(sql`count(*) DESC`)
    .limit(10) as LeaderboardEntry[];

  // Most Bot Collaborations: chat sessions grouped by createdBy
  const mostBotCollaborations = await db
    .select({
      userId: chatSession.createdBy,
      name: user.name,
      image: user.image,
      count: count(),
    })
    .from(chatSession)
    .innerJoin(user, eq(user.id, chatSession.createdBy))
    .where(eq(chatSession.workspaceId, workspaceId))
    .groupBy(chatSession.createdBy, user.name, user.image)
    .orderBy(sql`count(*) DESC`)
    .limit(10) as LeaderboardEntry[];

  // ─── Evaluation Stats ─────────────────────────────────────
  const evalStats = (await db
    .select({
      totalEvaluations: sql<number>`COUNT(*)`,
      avgJudgeScore: sql<number | null>`AVG(${evaluation.judgeScore})`,
      avgTokenOverlap: sql<number | null>`AVG(${evaluation.tokenOverlap})`,
    })
    .from(evaluation)
    .where(
      and(
        eq(evaluation.workspaceId, workspaceId),
        eq(evaluation.status, "completed")
      )
    )
    )[0];

  // ─── Domain Leaders ─────────────────────────────────────
  // Top 3 reviewers per domain by volume of accepted/excluded mappings
  const domainMappings = await db
    .select({
      assigneeId: fieldMapping.assigneeId,
      assigneeName: user.name,
      targetFieldId: fieldMapping.targetFieldId,
    })
    .from(fieldMapping)
    .innerJoin(user, eq(user.id, fieldMapping.assigneeId))
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        inArray(fieldMapping.status, ["accepted", "excluded"]),
        eq(fieldMapping.isLatest, true),
        sql`${fieldMapping.assigneeId} IS NOT NULL`,
        isNull(fieldMapping.transferId),
      ),
    );

  // Resolve field → domain
  const domainFieldIds = [...new Set(domainMappings.map((m) => m.targetFieldId))];
  const fieldDomainLookup = new Map<string, FieldDomain | null>();
  if (domainFieldIds.length > 0) {
    for (let i = 0; i < domainFieldIds.length; i += 500) {
      const chunk = domainFieldIds.slice(i, i + 500);
      const rows = await db
        .select({ fieldId: field.id, entityName: entity.name, domainTag: field.domainTag })
        .from(field)
        .innerJoin(entity, eq(field.entityId, entity.id))
        .where(inArray(field.id, chunk));
      for (const r of rows) {
        fieldDomainLookup.set(
          r.fieldId,
          (r.domainTag as FieldDomain) ?? ENTITY_DOMAIN_MAP[r.entityName]?.[0] ?? null,
        );
      }
    }
  }

  // Aggregate: domain → assignee → count
  const domainAssigneeCounts = new Map<string, Map<string, { name: string | null; count: number }>>();
  for (const m of domainMappings) {
    const domain = fieldDomainLookup.get(m.targetFieldId);
    if (!domain) continue;
    if (!domainAssigneeCounts.has(domain)) domainAssigneeCounts.set(domain, new Map());
    const assigneeMap = domainAssigneeCounts.get(domain)!;
    const cur = assigneeMap.get(m.assigneeId!) || { name: m.assigneeName, count: 0 };
    cur.count++;
    assigneeMap.set(m.assigneeId!, cur);
  }

  const domainLeaders = FIELD_DOMAINS.map((d) => {
    const assigneeMap = domainAssigneeCounts.get(d);
    if (!assigneeMap) return { domain: d, leaders: [] };
    const leaders = [...assigneeMap.entries()]
      .map(([userId, { name, count: c }]) => ({ userId, name, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { domain: d, leaders };
  }).filter((d) => d.leaders.length > 0);

  return NextResponse.json({
    totalEntities: entities.length,
    totalFields,
    mappedFields,
    coveragePercent:
      totalFields > 0 ? parseFloat(((mappedFields / totalFields) * 100).toFixed(2)) : 0,
    openQuestions: openQuestions?.cnt || 0,
    entities: entityStats,
    milestoneStats,
    statusDistribution,
    leaderboard: {
      mostMapped,
      mostQuestionsAnswered,
      mostBotCollaborations,
    },
    domainLeaders,
    evaluationStats: {
      totalEvaluations: evalStats?.totalEvaluations || 0,
      avgJudgeScore: evalStats?.avgJudgeScore
        ? Math.round(evalStats.avgJudgeScore * 10) / 10
        : null,
      avgTokenOverlap: evalStats?.avgTokenOverlap
        ? Math.round(evalStats.avgTokenOverlap)
        : null,
    },
  });
});
