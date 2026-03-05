/**
 * Auto-apply logic for skill refresh proposals.
 *
 * Risk scoring determines whether a proposal can be auto-applied or
 * requires human approval:
 * - Low risk (< 30): auto-apply (e.g., adding supplementary contexts)
 * - High risk (>= 30): requires human approval (e.g., removing contexts,
 *   adding primary contexts)
 */

import { db } from "@/lib/db";
import { skillRefresh, skillContext } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface SkillRefreshProposal {
  additions: { contextId: string; contextName: string; role: string }[];
  removals: { contextId: string; contextName: string }[];
  roleChanges: { contextId: string; contextName: string; fromRole: string; toRole: string }[];
  instructionUpdate?: string;
  riskScore: number;
}

const RISK_WEIGHTS: Record<string, number> = {
  add_supplementary: 5,
  add_reference: 10,
  add_primary: 20,
  remove: 25,
  role_change: 15,
  instruction_update: 10,
};

const AUTO_APPLY_THRESHOLD = 30;

/**
 * Score the risk of a proposal. Lower = safer to auto-apply.
 */
export function scoreProposalRisk(proposal: SkillRefreshProposal): number {
  let score = 0;

  for (const add of proposal.additions) {
    const key = `add_${add.role}` as keyof typeof RISK_WEIGHTS;
    score += RISK_WEIGHTS[key] ?? RISK_WEIGHTS.add_reference;
  }

  score += proposal.removals.length * RISK_WEIGHTS.remove;
  score += proposal.roleChanges.length * RISK_WEIGHTS.role_change;

  if (proposal.instructionUpdate) {
    score += RISK_WEIGHTS.instruction_update;
  }

  return score;
}

/**
 * Check if a proposal can be auto-applied based on its risk score.
 */
export function canAutoApply(proposal: SkillRefreshProposal): boolean {
  return proposal.riskScore < AUTO_APPLY_THRESHOLD;
}

/**
 * Auto-apply a low-risk proposal to a skill.
 * Only executes additions of supplementary/reference contexts.
 * Returns the changes that were applied.
 */
export async function autoApplyProposal(
  workspaceId: string,
  skillId: string,
  proposal: SkillRefreshProposal,
  refreshId: string,
): Promise<{ applied: boolean; changesApplied: Record<string, unknown> }> {
  if (!canAutoApply(proposal)) {
    return { applied: false, changesApplied: {} };
  }

  const now = new Date().toISOString();
  const appliedChanges: Record<string, unknown>[] = [];

  // Apply additions (only supplementary and reference for auto-apply)
  for (const add of proposal.additions) {
    if (add.role !== "supplementary" && add.role !== "reference") continue;

    // Check if already linked
    const existing = (await db
      .select({ id: skillContext.id })
      .from(skillContext)
      .where(
        and(
          eq(skillContext.skillId, skillId),
          eq(skillContext.contextId, add.contextId),
        )
      )
      )[0];

    if (existing) continue;

    await db.insert(skillContext)
      .values({
        skillId,
        contextId: add.contextId,
        role: add.role,
        sortOrder: 999,
        notes: `Auto-applied from skill refresh ${refreshId}`,
      })
      ;

    appliedChanges.push({
      type: "addition",
      contextId: add.contextId,
      contextName: add.contextName,
      role: add.role,
    });
  }

  // Update refresh record
  await db.update(skillRefresh)
    .set({
      status: "auto_applied",
      appliedChanges: { changes: appliedChanges },
      updatedAt: now,
    })
    .where(eq(skillRefresh.id, refreshId))
    ;

  return {
    applied: appliedChanges.length > 0,
    changesApplied: { changes: appliedChanges },
  };
}

/**
 * Apply a human-approved proposal to a skill.
 * Handles all change types including removals and role changes.
 */
export async function applyApprovedProposal(
  workspaceId: string,
  skillId: string,
  proposal: SkillRefreshProposal,
  refreshId: string,
  reviewedBy: string,
): Promise<{ changesApplied: Record<string, unknown> }> {
  const now = new Date().toISOString();
  const appliedChanges: Record<string, unknown>[] = [];

  // Apply additions
  for (const add of proposal.additions) {
    const existing = (await db
      .select({ id: skillContext.id })
      .from(skillContext)
      .where(
        and(
          eq(skillContext.skillId, skillId),
          eq(skillContext.contextId, add.contextId),
        )
      )
      )[0];

    if (existing) continue;

    await db.insert(skillContext)
      .values({
        skillId,
        contextId: add.contextId,
        role: add.role,
        sortOrder: 999,
        notes: `Applied from skill refresh ${refreshId}`,
      })
      ;

    appliedChanges.push({
      type: "addition",
      contextId: add.contextId,
      contextName: add.contextName,
      role: add.role,
    });
  }

  // Apply removals
  for (const rem of proposal.removals) {
    const sc = (await db
      .select({ id: skillContext.id })
      .from(skillContext)
      .where(
        and(
          eq(skillContext.skillId, skillId),
          eq(skillContext.contextId, rem.contextId),
        )
      )
      )[0];

    if (sc) {
      await db.delete(skillContext)
        .where(eq(skillContext.id, sc.id))
        ;

      appliedChanges.push({
        type: "removal",
        contextId: rem.contextId,
        contextName: rem.contextName,
      });
    }
  }

  // Apply role changes
  for (const rc of proposal.roleChanges) {
    const sc = (await db
      .select({ id: skillContext.id })
      .from(skillContext)
      .where(
        and(
          eq(skillContext.skillId, skillId),
          eq(skillContext.contextId, rc.contextId),
        )
      )
      )[0];

    if (sc) {
      await db.update(skillContext)
        .set({ role: rc.toRole })
        .where(eq(skillContext.id, sc.id))
        ;

      appliedChanges.push({
        type: "role_change",
        contextId: rc.contextId,
        contextName: rc.contextName,
        from: rc.fromRole,
        to: rc.toRole,
      });
    }
  }

  // Update refresh record
  await db.update(skillRefresh)
    .set({
      status: "approved",
      appliedChanges: { changes: appliedChanges },
      reviewedBy,
      updatedAt: now,
    })
    .where(eq(skillRefresh.id, refreshId))
    ;

  return { changesApplied: { changes: appliedChanges } };
}
