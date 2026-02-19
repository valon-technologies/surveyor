/**
 * Universal system context bundle — loaded once per generation and injected
 * into the system message instead of duplicated across every skill.
 *
 * Moves these universal docs from per-skill context assembly into the system message:
 * - Critical Rules and Workflow
 * - Mapping Patterns
 * - Table Relationships
 * - Domain overviews (condensed to ~500 tokens each)
 *
 * MAPPING DECISIONS is too large (~51K tokens) — moved to RAG-only retrieval.
 */

import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { estimateTokens } from "@/lib/llm/token-counter";

export interface SystemContextBundle {
  criticalRulesAndWorkflow: string | null;
  mappingPatterns: string | null;
  tableRelationships: string | null;
  domainOverviewBrief: string | null;
  totalTokens: number;
}

/** Context names that are embedded in the system message (excluded from skill assembly) */
export const SYSTEM_EMBEDDED_NAMES = new Set([
  "Mapping > Critical Rules and Workflow",
  "Mapping > Patterns",
  "ServiceMac > TABLE RELATIONSHIPS",
  "VDS > Overview",
  "ServiceMac > Overview",
  "Mortgage Servicing > Overview",
]);

/** Context names that are RAG-only (excluded from skill assembly, retrieved on-demand) */
export const RAG_ONLY_NAMES = new Set([
  "ServiceMac > MAPPING DECISIONS",
]);

// ── Cache ────────────────────────────────────────────────────

const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  bundle: SystemContextBundle;
  createdAt: number;
}

const bundleCache = new Map<string, CacheEntry>();

/**
 * Load the universal context bundle for a workspace, with 10-minute TTL cache.
 */
export function getSystemContextBundle(workspaceId: string): SystemContextBundle {
  const cached = bundleCache.get(workspaceId);
  if (cached && Date.now() - cached.createdAt < TTL_MS) {
    return cached.bundle;
  }

  const loadContent = (name: string): string | null => {
    const row = db
      .select({ content: context.content })
      .from(context)
      .where(
        and(
          eq(context.workspaceId, workspaceId),
          eq(context.name, name),
          eq(context.isActive, true),
        )
      )
      .get();
    return row?.content ?? null;
  };

  const condenseOverview = (content: string | null, maxChars = 2000): string | null => {
    if (!content) return null;
    if (content.length <= maxChars) return content;
    return content.slice(0, maxChars).trimEnd() + "\n\n[... condensed for brevity]";
  };

  const criticalRulesAndWorkflow = loadContent("Mapping > Critical Rules and Workflow");
  const mappingPatterns = loadContent("Mapping > Patterns");
  const tableRelationships = loadContent("ServiceMac > TABLE RELATIONSHIPS");

  const vdsOverview = condenseOverview(loadContent("VDS > Overview"));
  const smOverview = condenseOverview(loadContent("ServiceMac > Overview"));
  const mortgageOverview = condenseOverview(loadContent("Mortgage Servicing > Overview"));

  // Combine domain overviews into a single brief section
  const overviewParts: string[] = [];
  if (vdsOverview) overviewParts.push(`### VDS (Target Schema)\n${vdsOverview}`);
  if (smOverview) overviewParts.push(`### ServiceMac (Source System)\n${smOverview}`);
  if (mortgageOverview) overviewParts.push(`### Mortgage Servicing (Domain)\n${mortgageOverview}`);
  const domainOverviewBrief = overviewParts.length > 0 ? overviewParts.join("\n\n") : null;

  let totalTokens = 0;
  if (criticalRulesAndWorkflow) totalTokens += estimateTokens(criticalRulesAndWorkflow);
  if (mappingPatterns) totalTokens += estimateTokens(mappingPatterns);
  if (tableRelationships) totalTokens += estimateTokens(tableRelationships);
  if (domainOverviewBrief) totalTokens += estimateTokens(domainOverviewBrief);

  const bundle: SystemContextBundle = {
    criticalRulesAndWorkflow,
    mappingPatterns,
    tableRelationships,
    domainOverviewBrief,
    totalTokens,
  };

  bundleCache.set(workspaceId, { bundle, createdAt: Date.now() });
  return bundle;
}

/**
 * Render the universal context bundle as a system message section.
 */
export function renderSystemContextSection(bundle: SystemContextBundle): string {
  const parts: string[] = [];
  parts.push(`\n## Universal Reference Context`);

  if (bundle.criticalRulesAndWorkflow) {
    parts.push(`\n### Critical Rules and Workflow\n${bundle.criticalRulesAndWorkflow}`);
  }

  if (bundle.mappingPatterns) {
    parts.push(`\n### Mapping Patterns\n${bundle.mappingPatterns}`);
  }

  if (bundle.tableRelationships) {
    parts.push(`\n### Table Relationships\n${bundle.tableRelationships}`);
  }

  if (bundle.domainOverviewBrief) {
    parts.push(`\n### Domain Orientation\n${bundle.domainOverviewBrief}`);
  }

  // Hint for RAG retrieval of MAPPING DECISIONS
  parts.push(
    `\nNOTE: For prior mapping decisions, use \`get_reference_docs\` with query "mapping decisions". ` +
    `This document contains entity-by-entity mapping decisions from prior analysis sessions.`
  );

  return parts.join("\n");
}

/**
 * Invalidate the system context cache for a workspace (e.g., after context import).
 */
export function invalidateSystemContextCache(workspaceId: string): void {
  bundleCache.delete(workspaceId);
}
