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
import { eq, and, sql, count, notInArray, inArray } from "drizzle-orm";
import { MILESTONES } from "@/lib/constants";
import type {
  LeaderboardEntry,
  AssignedFieldItem,
  MyQuestionItem,
} from "@/types/dashboard";

export const GET = withAuth(async (req, ctx, { workspaceId, userId }) => {
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab");

  // ─── My Work Tab ──────────────────────────────────────────
  if (tab === "my-work") {
    // Assigned fields: latest mappings assigned to current user, not yet closed
    const assignedFields: AssignedFieldItem[] = db
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
          notInArray(fieldMapping.status, ["accepted", "excluded"])
        )
      )
      .orderBy(entity.sortOrder, field.sortOrder)
      .all();

    // My questions: open questions I created or am assigned to
    const allOpenQuestions = db
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
      .all();

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
        const f = db
          .select({ name: field.name })
          .from(field)
          .where(eq(field.id, q.fieldId))
          .get();
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
  const entities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .orderBy(entity.sortOrder)
    .all();

  // Identify assembly parent entities (those that have child entities)
  // Assembly parents don't have direct field mappings — stats derive from children
  const assemblyParentIds = new Set<string>();
  for (const e of entities) {
    if (e.parentEntityId) {
      assemblyParentIds.add(e.parentEntityId);
    }
  }

  // Get field counts and mapping stats per entity
  const entityStats = entities.map((e) => {
    // Assembly parents: zero out field stats (component aggregates from children)
    if (assemblyParentIds.has(e.id)) {
      const openQs = db
        .select({ cnt: count() })
        .from(question)
        .where(and(eq(question.entityId, e.id), eq(question.status, "open")))
        .get();
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

    const fields = db
      .select({ id: field.id })
      .from(field)
      .where(eq(field.entityId, e.id))
      .all();

    const fieldIds = fields.map((f) => f.id);
    const statusCounts: Record<string, number> = {};

    if (fieldIds.length > 0) {
      const mappings = db
        .select({
          status: sql<string>`COALESCE(${fieldMapping.status}, 'unmapped')`,
          cnt: count(),
        })
        .from(field)
        .leftJoin(
          fieldMapping,
          and(
            eq(fieldMapping.targetFieldId, field.id),
            eq(fieldMapping.isLatest, true)
          )
        )
        .where(
          sql`${field.id} IN (${sql.join(
            fieldIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )
        .groupBy(sql`COALESCE(${fieldMapping.status}, 'unmapped')`)
        .all();

      for (const m of mappings) {
        statusCounts[m.status] = m.cnt;
      }
    }

    const mappedCount = (statusCounts["accepted"] || 0) + (statusCounts["excluded"] || 0);

    const openQs = db
      .select({ cnt: count() })
      .from(question)
      .where(and(eq(question.entityId, e.id), eq(question.status, "open")))
      .get();

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
          ? Math.round((mappedCount / fields.length) * 100)
          : 0,
      openQuestions: openQs?.cnt || 0,
      statusBreakdown: statusCounts,
    };
  });

  // Milestone stats
  const milestoneStats = MILESTONES.map((m) => {
    const rows = db
      .select({
        status: sql<string>`COALESCE(${fieldMapping.status}, 'unmapped')`,
        cnt: count(),
      })
      .from(field)
      .innerJoin(entity, eq(field.entityId, entity.id))
      .leftJoin(
        fieldMapping,
        and(
          eq(fieldMapping.targetFieldId, field.id),
          eq(fieldMapping.isLatest, true)
        )
      )
      .where(
        and(
          eq(entity.workspaceId, workspaceId),
          eq(entity.side, "target"),
          eq(field.milestone, m),
          assemblyParentIds.size > 0
            ? sql`${entity.id} NOT IN (${sql.join([...assemblyParentIds].map(id => sql`${id}`), sql`, `)})`
            : undefined
        )
      )
      .groupBy(sql`COALESCE(${fieldMapping.status}, 'unmapped')`)
      .all();

    const statusBreakdown: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      statusBreakdown[r.status] = r.cnt;
      total += r.cnt;
    }

    const mapped = (statusBreakdown["accepted"] || 0) + (statusBreakdown["excluded"] || 0);

    return {
      milestone: m,
      totalFields: total,
      mappedFields: mapped,
      coveragePercent: total > 0 ? Math.round((mapped / total) * 100) : 0,
      statusBreakdown,
    };
  });

  // Aggregate stats
  const totalFields = entityStats.reduce((sum, e) => sum + e.fieldCount, 0);
  const mappedFields = entityStats.reduce((sum, e) => sum + e.mappedCount, 0);

  // Status distribution
  const allFieldStatuses = db
    .select({
      status: sql<string>`COALESCE(${fieldMapping.status}, 'unmapped')`,
      cnt: count(),
    })
    .from(field)
    .innerJoin(entity, eq(field.entityId, entity.id))
    .leftJoin(
      fieldMapping,
      and(
        eq(fieldMapping.targetFieldId, field.id),
        eq(fieldMapping.isLatest, true)
      )
    )
    .where(
      and(
        eq(entity.workspaceId, workspaceId),
        eq(entity.side, "target"),
        assemblyParentIds.size > 0
          ? sql`${entity.id} NOT IN (${sql.join([...assemblyParentIds].map(id => sql`${id}`), sql`, `)})`
          : undefined
      )
    )
    .groupBy(sql`COALESCE(${fieldMapping.status}, 'unmapped')`)
    .all();

  const statusDistribution: Record<string, number> = {};
  for (const r of allFieldStatuses) {
    statusDistribution[r.status] = r.cnt;
  }

  const openQuestions = db
    .select({ cnt: count() })
    .from(question)
    .where(
      and(eq(question.workspaceId, workspaceId), eq(question.status, "open"))
    )
    .get();

  // ─── Leaderboard Queries ────────────────────────────────────

  // Most Mapped: accepted + isLatest, grouped by assigneeId
  const mostMapped: LeaderboardEntry[] = db
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
        sql`${fieldMapping.assigneeId} IS NOT NULL`
      )
    )
    .groupBy(fieldMapping.assigneeId, user.name, user.image)
    .orderBy(sql`count(*) DESC`)
    .limit(10)
    .all() as LeaderboardEntry[];

  // Most Questions Answered: resolved questions grouped by resolvedBy
  const mostQuestionsAnswered: LeaderboardEntry[] = db
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
    .limit(10)
    .all() as LeaderboardEntry[];

  // Most Bot Collaborations: chat sessions grouped by createdBy
  const mostBotCollaborations: LeaderboardEntry[] = db
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
    .limit(10)
    .all() as LeaderboardEntry[];

  // ─── Evaluation Stats ─────────────────────────────────────
  const evalStats = db
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
    .get();

  return NextResponse.json({
    totalEntities: entities.length,
    totalFields,
    mappedFields,
    coveragePercent:
      totalFields > 0 ? Math.round((mappedFields / totalFields) * 100) : 0,
    openQuestions: openQuestions?.cnt || 0,
    entities: entityStats,
    milestoneStats,
    statusDistribution,
    leaderboard: {
      mostMapped,
      mostQuestionsAnswered,
      mostBotCollaborations,
    },
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
