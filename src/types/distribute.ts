import type { FieldDomain } from "@/lib/constants";

// ─── Request / Response shapes for POST /mappings/distribute ──────────────

export interface DistributeRequest {
  /**
   * Which statuses are eligible for (re)assignment.
   * Defaults to ["unmapped"] so accepted/punted work is never touched.
   */
  eligibleStatuses?: string[];

  /**
   * Restrict distribution to fields belonging to these entities.
   * Omit to distribute across the entire workspace.
   */
  entityIds?: string[];

  /**
   * Restrict distribution to these specific domain buckets.
   * Omit to include all domains.
   */
  domains?: FieldDomain[];

  /**
   * Only assign to users who have opted into the relevant domain.
   * When false (default) any editor/owner is eligible as a fallback
   * if no domain-matched users exist.
   */
  strictDomainMatch?: boolean;

  /**
   * Round-robin (default) assigns one field per user in turn.
   * Least-loaded picks the user with the fewest current assignments.
   */
  strategy?: "round_robin" | "least_loaded";

  /** Dry run — compute the plan but do not write any assignments. */
  dryRun?: boolean;
}

export interface DistributeAssignment {
  fieldMappingId: string;
  targetFieldId: string;
  fieldName: string;
  entityName: string;
  domain: FieldDomain | null;
  assigneeId: string;
  assigneeName: string | null;
  /** Whether this reassigns an existing assignee. */
  isReassignment: boolean;
}

export interface DistributeSummary {
  /** Total fields considered (after status/entity/domain filters). */
  totalEligible: number;
  /** Fields that received an assignee. */
  assigned: number;
  /** Fields skipped because no eligible users matched the domain. */
  skipped: number;
  /** Per-user breakdown of how many fields were assigned. */
  byAssignee: { userId: string; name: string | null; count: number }[];
  /** Per-domain breakdown. */
  byDomain: { domain: FieldDomain | null; count: number }[];
}

export interface DistributeResponse {
  summary: DistributeSummary;
  assignments: DistributeAssignment[];
  /** true when dryRun was requested — no DB writes occurred. */
  dryRun: boolean;
}

// ─── User domain preference shape (returned by /members endpoint) ─────────

export interface UserDomainPreference {
  userId: string;
  name: string | null;
  email: string;
  domains: FieldDomain[] | null;
}
