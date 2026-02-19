/**
 * Skill signal tracking — events that indicate a skill needs refreshing.
 *
 * Signal types:
 * - question_resolved: SM answered a question about this entity
 * - chat_insight: Substantive insight from a chat discussion
 * - mapping_correction: Human corrected an LLM-generated mapping
 * - schema_change: Source or target schema was updated
 * - context_added: New context document added for this entity
 * - context_gap: LLM identified a missing context during generation
 *
 * Weighted scores determine when to trigger a skill refresh.
 */

import { db } from "@/lib/db";
import { skillSignal, skill, batchRun } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export type SignalType =
  | "question_resolved"
  | "chat_insight"
  | "mapping_correction"
  | "schema_change"
  | "context_added"
  | "context_gap";

const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  mapping_correction: 4,
  schema_change: 5,
  chat_insight: 3,
  context_gap: 3,
  question_resolved: 2,
  context_added: 1,
};

const REFRESH_THRESHOLD = 10;

export interface EmitSignalInput {
  workspaceId: string;
  entityId?: string;
  skillId?: string;
  signalType: SignalType;
  summary: string;
  sourceId?: string;
  sourceType?: string;
}

/**
 * Emit a skill signal. Signals accumulate and trigger skill refreshes
 * when their weighted score exceeds the threshold.
 */
export function emitSignal(input: EmitSignalInput): string {
  const now = new Date().toISOString();
  const weight = SIGNAL_WEIGHTS[input.signalType] ?? 1;

  const [signal] = db
    .insert(skillSignal)
    .values({
      workspaceId: input.workspaceId,
      entityId: input.entityId ?? null,
      skillId: input.skillId ?? null,
      signalType: input.signalType,
      weight,
      summary: input.summary,
      sourceId: input.sourceId ?? null,
      sourceType: input.sourceType ?? null,
      processed: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: skillSignal.id })
    .all();

  return signal.id;
}

export interface SignalEvaluation {
  score: number;
  signals: { id: string; type: SignalType; weight: number; summary: string; createdAt: string }[];
  shouldRefresh: boolean;
}

/**
 * Evaluate accumulated signals for an entity to determine if its
 * skill should be refreshed.
 */
export function evaluateSignals(
  workspaceId: string,
  entityId: string,
): SignalEvaluation {
  // Check if there's an active batch run — debounce during batch processing
  const activeBatch = db
    .select({ id: batchRun.id })
    .from(batchRun)
    .where(
      and(
        eq(batchRun.workspaceId, workspaceId),
        eq(batchRun.status, "running"),
      )
    )
    .get();

  if (activeBatch) {
    return { score: 0, signals: [], shouldRefresh: false };
  }

  // Load unprocessed signals for this entity
  const signals = db
    .select()
    .from(skillSignal)
    .where(
      and(
        eq(skillSignal.workspaceId, workspaceId),
        eq(skillSignal.entityId, entityId),
        eq(skillSignal.processed, false),
      )
    )
    .orderBy(desc(skillSignal.createdAt))
    .all();

  const score = signals.reduce((sum, s) => sum + (s.weight ?? 0), 0);

  return {
    score,
    signals: signals.map((s) => ({
      id: s.id,
      type: s.signalType as SignalType,
      weight: s.weight ?? 0,
      summary: s.summary,
      createdAt: s.createdAt,
    })),
    shouldRefresh: score >= REFRESH_THRESHOLD,
  };
}

export interface SignalQueueEntry {
  entityId: string;
  entityName: string;
  score: number;
  signalCount: number;
  latestSignal: string;
  shouldRefresh: boolean;
}

/**
 * Get the signal queue for a workspace — entities grouped by accumulated score.
 */
export function getSignalQueueForWorkspace(
  workspaceId: string,
): SignalQueueEntry[] {
  // Aggregate unprocessed signals by entity
  const rows = db
    .select({
      entityId: skillSignal.entityId,
      totalWeight: sql<number>`SUM(${skillSignal.weight})`,
      signalCount: sql<number>`COUNT(*)`,
      latestCreatedAt: sql<string>`MAX(${skillSignal.createdAt})`,
    })
    .from(skillSignal)
    .where(
      and(
        eq(skillSignal.workspaceId, workspaceId),
        eq(skillSignal.processed, false),
        sql`${skillSignal.entityId} IS NOT NULL`,
      )
    )
    .groupBy(skillSignal.entityId)
    .orderBy(sql`SUM(${skillSignal.weight}) DESC`)
    .all();

  // Resolve entity names
  return rows
    .filter((r) => r.entityId)
    .map((r) => {
      // Load entity name
      const entityRow = db
        .select({ name: sql<string>`COALESCE(display_name, name)` })
        .from(sql`entity`)
        .where(sql`id = ${r.entityId}`)
        .get();

      return {
        entityId: r.entityId!,
        entityName: (entityRow as any)?.name ?? r.entityId!,
        score: r.totalWeight ?? 0,
        signalCount: r.signalCount ?? 0,
        latestSignal: r.latestCreatedAt ?? "",
        shouldRefresh: (r.totalWeight ?? 0) >= REFRESH_THRESHOLD,
      };
    });
}

/**
 * Mark signals as processed (e.g., after a skill refresh).
 */
export function markSignalsProcessed(signalIds: string[]): void {
  if (signalIds.length === 0) return;

  const now = new Date().toISOString();

  for (const id of signalIds) {
    db.update(skillSignal)
      .set({ processed: true, processedAt: now, updatedAt: now })
      .where(eq(skillSignal.id, id))
      .run();
  }
}
