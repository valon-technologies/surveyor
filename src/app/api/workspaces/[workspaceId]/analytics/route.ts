import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { analyticsEvent, user, fieldMapping, field } from "@/lib/db/schema";
import { eq, and, sql, gte, count, inArray } from "drizzle-orm";

export const GET = withAuth(async (req, _ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const days = parseInt(searchParams.get("days") || "30", 10);
  const milestone = searchParams.get("milestone"); // e.g. "M2.5"
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const wsFilter = eq(analyticsEvent.workspaceId, workspaceId);
  const dateFilter = gte(analyticsEvent.createdAt, since);

  // When milestone is set, restrict to events whose fieldMappingId belongs to
  // a field_mapping targeting a field with that milestone.
  let milestoneEventIds: string[] | null = null;
  if (milestone) {
    const rows = await db
      .select({ eventId: analyticsEvent.id })
      .from(analyticsEvent)
      .innerJoin(fieldMapping, eq(analyticsEvent.fieldMappingId, fieldMapping.id))
      .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
      .where(and(wsFilter, dateFilter, eq(field.milestone, milestone)));
    milestoneEventIds = rows.map((r) => r.eventId);
    // If no events match, return empty stats immediately
    if (milestoneEventIds.length === 0) {
      return NextResponse.json(emptyResponse(days, since, milestone));
    }
  }

  const baseWhere = milestoneEventIds
    ? and(wsFilter, dateFilter, inArray(analyticsEvent.id, milestoneEventIds))
    : and(wsFilter, dateFilter);

  // Run all aggregation queries in parallel
  const [
    eventCounts,
    reviewDurations,
    dailyCounts,
    topReviewers,
    perUserEvents,
    perUserDurations,
  ] = await Promise.all([
    // 1. Event counts by name
    db
      .select({
        eventName: analyticsEvent.eventName,
        count: count(),
      })
      .from(analyticsEvent)
      .where(baseWhere)
      .groupBy(analyticsEvent.eventName),

    // 2. Review duration stats (from review_submitted events)
    db
      .select({
        avgDuration: sql<number>`coalesce(avg(${analyticsEvent.durationMs}), 0)::int`,
        medianDuration: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${analyticsEvent.durationMs}), 0)::int`,
        p90Duration: sql<number>`coalesce(percentile_cont(0.9) within group (order by ${analyticsEvent.durationMs}), 0)::int`,
        minDuration: sql<number>`coalesce(min(${analyticsEvent.durationMs}), 0)::int`,
        maxDuration: sql<number>`coalesce(max(${analyticsEvent.durationMs}), 0)::int`,
      })
      .from(analyticsEvent)
      .where(
        and(
          baseWhere,
          eq(analyticsEvent.eventName, "review_submitted"),
          sql`${analyticsEvent.durationMs} is not null`
        )
      ),

    // 3. Daily event counts (for trend chart)
    db
      .select({
        date: sql<string>`left(${analyticsEvent.createdAt}, 10)`.as("date"),
        eventName: analyticsEvent.eventName,
        count: count(),
      })
      .from(analyticsEvent)
      .where(baseWhere)
      .groupBy(sql`left(${analyticsEvent.createdAt}, 10)`, analyticsEvent.eventName)
      .orderBy(sql`left(${analyticsEvent.createdAt}, 10)`),

    // 4. Top reviewers by review_submitted count
    db
      .select({
        userId: analyticsEvent.userId,
        userName: user.name,
        reviewCount: count(),
      })
      .from(analyticsEvent)
      .leftJoin(user, eq(analyticsEvent.userId, user.id))
      .where(and(baseWhere, eq(analyticsEvent.eventName, "review_submitted")))
      .groupBy(analyticsEvent.userId, user.name)
      .orderBy(sql`count(*) desc`)
      .limit(10),

    // 5. Per-user event breakdown
    db
      .select({
        userId: analyticsEvent.userId,
        userName: user.name,
        eventName: analyticsEvent.eventName,
        count: count(),
      })
      .from(analyticsEvent)
      .leftJoin(user, eq(analyticsEvent.userId, user.id))
      .where(baseWhere)
      .groupBy(analyticsEvent.userId, user.name, analyticsEvent.eventName),

    // 6. Per-user avg review duration
    db
      .select({
        userId: analyticsEvent.userId,
        userName: user.name,
        avgDuration: sql<number>`coalesce(avg(${analyticsEvent.durationMs}), 0)::int`,
        medianDuration: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${analyticsEvent.durationMs}), 0)::int`,
      })
      .from(analyticsEvent)
      .leftJoin(user, eq(analyticsEvent.userId, user.id))
      .where(
        and(
          baseWhere,
          eq(analyticsEvent.eventName, "review_submitted"),
          sql`${analyticsEvent.durationMs} is not null`
        )
      )
      .groupBy(analyticsEvent.userId, user.name),
  ]);

  // Compute derived metrics
  const countMap: Record<string, number> = {};
  for (const row of eventCounts) {
    countMap[row.eventName] = Number(row.count);
  }

  const totalReviews = countMap["review_submitted"] || 0;
  const totalStarted = countMap["review_started"] || 0;
  const totalAbandoned = countMap["review_abandoned"] || 0;
  const aiAccepted = countMap["ai_suggestion_accepted"] || 0;
  const aiOverridden = countMap["ai_suggestion_overridden"] || 0;
  const whyWrongCount = countMap["why_wrong_provided"] || 0;
  const chatSent = countMap["ai_chat_sent"] || 0;
  const chatChangedMind = countMap["ai_chat_changed_mind"] || 0;

  const completionRate = totalStarted > 0 ? totalReviews / totalStarted : 0;
  const aiAcceptanceRate =
    aiAccepted + aiOverridden > 0
      ? aiAccepted / (aiAccepted + aiOverridden)
      : 0;
  const chatInfluenceRate =
    chatSent > 0 ? chatChangedMind / chatSent : 0;

  const duration = reviewDurations[0] || {
    avgDuration: 0,
    medianDuration: 0,
    p90Duration: 0,
    minDuration: 0,
    maxDuration: 0,
  };

  // Build per-user breakdown
  const userMap = new Map<string, {
    userId: string; name: string;
    reviewed: number; started: number; abandoned: number;
    accepted: number; overridden: number; whyWrong: number;
    chatSent: number; chatChanged: number;
    avgDurationMs: number; medianDurationMs: number;
  }>();

  for (const row of perUserEvents) {
    const uid = row.userId || "unknown";
    if (!userMap.has(uid)) {
      userMap.set(uid, {
        userId: uid, name: row.userName || "Unknown",
        reviewed: 0, started: 0, abandoned: 0,
        accepted: 0, overridden: 0, whyWrong: 0,
        chatSent: 0, chatChanged: 0,
        avgDurationMs: 0, medianDurationMs: 0,
      });
    }
    const u = userMap.get(uid)!;
    const c = Number(row.count);
    switch (row.eventName) {
      case "review_submitted": u.reviewed = c; break;
      case "review_started": u.started = c; break;
      case "review_abandoned": u.abandoned = c; break;
      case "ai_suggestion_accepted": u.accepted = c; break;
      case "ai_suggestion_overridden": u.overridden = c; break;
      case "why_wrong_provided": u.whyWrong = c; break;
      case "ai_chat_sent": u.chatSent = c; break;
      case "ai_chat_changed_mind": u.chatChanged = c; break;
    }
  }

  for (const row of perUserDurations) {
    const uid = row.userId || "unknown";
    const u = userMap.get(uid);
    if (u) {
      u.avgDurationMs = row.avgDuration;
      u.medianDurationMs = row.medianDuration;
    }
  }

  const perUser = Array.from(userMap.values()).sort((a, b) => b.reviewed - a.reviewed);

  return NextResponse.json({
    period: { days, since },
    milestone: milestone || null,
    reviewEfficiency: {
      totalStarted,
      totalCompleted: totalReviews,
      totalAbandoned,
      completionRate: Math.round(completionRate * 100),
      avgDurationMs: duration.avgDuration,
      medianDurationMs: duration.medianDuration,
      p90DurationMs: duration.p90Duration,
    },
    aiValue: {
      suggestionsAccepted: aiAccepted,
      suggestionsOverridden: aiOverridden,
      acceptanceRate: Math.round(aiAcceptanceRate * 100),
      chatMessagesSent: chatSent,
      chatChangedMind,
      chatInfluenceRate: Math.round(chatInfluenceRate * 100),
    },
    qualityAndLearning: {
      whyWrongProvided: whyWrongCount,
      whyWrongRate:
        aiOverridden > 0 ? Math.round((whyWrongCount / aiOverridden) * 100) : 0,
      topReviewers: topReviewers.map((r) => ({
        userId: r.userId,
        name: r.userName || "Unknown",
        reviewCount: Number(r.reviewCount),
      })),
    },
    dailyTrend: dailyCounts.map((d) => ({
      date: d.date,
      event: d.eventName,
      count: Number(d.count),
    })),
    perUser,
    eventCounts: countMap,
  });
}, { requiredRole: "owner" });

function emptyResponse(days: number, since: string, milestone: string | null) {
  return {
    period: { days, since },
    milestone,
    reviewEfficiency: {
      totalStarted: 0, totalCompleted: 0, totalAbandoned: 0,
      completionRate: 0, avgDurationMs: 0, medianDurationMs: 0, p90DurationMs: 0,
    },
    aiValue: {
      suggestionsAccepted: 0, suggestionsOverridden: 0, acceptanceRate: 0,
      chatMessagesSent: 0, chatChangedMind: 0, chatInfluenceRate: 0,
    },
    qualityAndLearning: { whyWrongProvided: 0, whyWrongRate: 0, topReviewers: [] },
    dailyTrend: [],
    perUser: [],
    eventCounts: {},
  };
}
