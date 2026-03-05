/**
 * POST /api/workspaces/[workspaceId]/mappings/distribute
 *
 * Auto-distributes unassigned (or re-distributes eligible) field mappings
 * to workspace members based on each user's declared domain preferences and
 * each entity/field's domain tag(s).
 *
 * Algorithm overview
 * ──────────────────
 * 1. Load all eligible mappings (status filter, optional entity/domain filter).
 * 2. For each mapping resolve its effective domain:
 *      a. field.domainTag  (explicit per-field override — wins for multi-domain entities)
 *      b. entity.domainTags[0]  (entity-level tag; if multi-domain, first is primary)
 *      c. null  (no domain — falls back to unfiltered pool)
 * 3. Build eligible assignee pool:
 *      – workspace members with role "editor" or "owner"
 *      – if strictDomainMatch=true: only users whose user.domains includes
 *        the field's resolved domain
 *      – if strictDomainMatch=false (default): prefer domain-matched users;
 *        fall back to all editors if no match exists
 * 4. Distribute using the chosen strategy:
 *      round_robin  — cycle through the pool in order, one field at a time
 *      least_loaded — always pick the user with the current fewest assignments
 * 5. Upsert assigneeId on the latest fieldMapping row (no new version created —
 *    assignment is metadata, not a mapping change).
 *
 * TODO (implementation phase):
 *  – Wire up Zod validation for DistributeRequest
 *  – Implement the resolver + distributor functions below
 *  – Add activity log entries for each reassignment
 *  – Expose dry-run preview in UI before committing
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping, field, entity, user, userWorkspace } from "@/lib/db/schema";
import { eq, and, inArray, notInArray, isNull, or } from "drizzle-orm";
import type { FieldDomain } from "@/lib/constants";
import type {
  DistributeRequest,
  DistributeResponse,
  DistributeAssignment,
  DistributeSummary,
} from "@/types/distribute";

export const POST = withAuth(async (req: NextRequest, _ctx, { workspaceId }) => {
  const body: DistributeRequest = await req.json();

  const {
    eligibleStatuses = ["unmapped"],
    entityIds,
    domains,
    strictDomainMatch = false,
    strategy = "round_robin",
    dryRun = false,
  } = body;

  // ── 1. Load eligible mappings ──────────────────────────────────────────────
  const mappingRows = await db
    .select({
      mappingId:     fieldMapping.id,
      targetFieldId: fieldMapping.targetFieldId,
      assigneeId:    fieldMapping.assigneeId,
      fieldName:     field.name,
      entityId:      field.entityId,
      entityName:    entity.name,
      // resolved domain: field-level override wins over entity-level
      fieldDomainTag:   field.domainTag,
      entityDomainTags: entity.domainTags,
    })
    .from(fieldMapping)
    .innerJoin(field, eq(field.id, fieldMapping.targetFieldId))
    .innerJoin(entity, eq(entity.id, field.entityId))
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true),
        inArray(fieldMapping.status, eligibleStatuses),
        isNull(fieldMapping.transferId),
        entityIds?.length ? inArray(field.entityId, entityIds) : undefined,
      )
    )
    ;

  // ── 2. Resolve effective domain per mapping ────────────────────────────────
  const withDomain = mappingRows.map((row) => {
    const effectiveDomain: FieldDomain | null =
      (row.fieldDomainTag as FieldDomain | null) ??
      ((row.entityDomainTags as string[] | null)?.[0] as FieldDomain | undefined) ??
      null;
    return { ...row, effectiveDomain };
  });

  // Optional domain filter on the distribution run itself
  const filtered = domains?.length
    ? withDomain.filter((r) => r.effectiveDomain && domains.includes(r.effectiveDomain))
    : withDomain;

  // ── 3. Build eligible assignee pool ───────────────────────────────────────
  const members = await db
    .select({
      userId:  user.id,
      name:    user.name,
      email:   user.email,
      role:    userWorkspace.role,
      domains: user.domains,
    })
    .from(userWorkspace)
    .innerJoin(user, eq(userWorkspace.userId, user.id))
    .where(
      and(
        eq(userWorkspace.workspaceId, workspaceId),
        inArray(userWorkspace.role, ["owner", "editor"]),
      )
    )
    ;

  // ── 4. Distribute ──────────────────────────────────────────────────────────
  const assignments: DistributeAssignment[] = [];
  const skipped: typeof filtered = [];

  // Assignment counters per user (for least_loaded)
  const assignmentCounts: Record<string, number> = Object.fromEntries(
    members.map((m) => [m.userId, 0])
  );

  for (const row of filtered) {
    const pool = resolvePool(row.effectiveDomain, members, strictDomainMatch);

    if (pool.length === 0) {
      skipped.push(row);
      continue;
    }

    const assignee =
      strategy === "least_loaded"
        ? pool.reduce((a, b) =>
            (assignmentCounts[a.userId] ?? 0) <= (assignmentCounts[b.userId] ?? 0) ? a : b
          )
        : pool[assignments.filter((a) => pool.some((p) => p.userId === a.assigneeId)).length % pool.length];

    assignmentCounts[assignee.userId] = (assignmentCounts[assignee.userId] ?? 0) + 1;

    assignments.push({
      fieldMappingId:  row.mappingId,
      targetFieldId:   row.targetFieldId,
      fieldName:       row.fieldName,
      entityName:      row.entityName,
      domain:          row.effectiveDomain,
      assigneeId:      assignee.userId,
      assigneeName:    assignee.name,
      isReassignment:  row.assigneeId !== null && row.assigneeId !== assignee.userId,
    });
  }

  // ── 5. Persist (unless dry run) ───────────────────────────────────────────
  if (!dryRun) {
    for (const a of assignments) {
      await db.update(fieldMapping)
        .set({ assigneeId: a.assigneeId, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(fieldMapping.id, a.fieldMappingId),
            eq(fieldMapping.isLatest, true),
          )
        )
        ;
    }
  }

  // ── 6. Build summary ──────────────────────────────────────────────────────
  const byAssignee = members.map((m) => ({
    userId: m.userId,
    name:   m.name,
    count:  assignments.filter((a) => a.assigneeId === m.userId).length,
  }));

  const domainKeys = [...new Set(assignments.map((a) => a.domain))];
  const byDomain = domainKeys.map((d) => ({
    domain: d,
    count:  assignments.filter((a) => a.domain === d).length,
  }));

  const summary: DistributeSummary = {
    totalEligible: filtered.length,
    assigned:      assignments.length,
    skipped:       skipped.length,
    byAssignee,
    byDomain,
  };

  const response: DistributeResponse = { summary, assignments, dryRun };
  return NextResponse.json(response, { status: dryRun ? 200 : 201 });
}, { requiredRole: "owner" });

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MemberRow = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  domains: string[] | null;
};

/**
 * Return the subset of members eligible to receive a field with the given domain.
 * Falls back to the full editor pool when strictDomainMatch is false and no
 * domain-matched users exist.
 */
function resolvePool(
  domain: FieldDomain | null,
  members: MemberRow[],
  strict: boolean,
): MemberRow[] {
  if (!domain) return members;

  const matched = members.filter(
    (m) => !m.domains || m.domains.length === 0 || m.domains.includes(domain)
  );

  if (matched.length > 0) return matched;
  if (strict) return [];          // no match, strict mode — skip this field
  return members;                 // fallback: spread to all editors
}
