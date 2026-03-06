/**
 * Extract mapping claims from Linear issues (MAP team).
 *
 * Usage:
 *   npx tsx scripts/harvest/extract-linear.ts [--dry-run]
 */

import { readFileSync } from "fs";

// Load .env.local before any other imports that read env vars
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import { linearGql } from "./lib/gestalt-client";
import { extractClaims } from "./lib/claim-extractor";
import { resolveEntity, resolveField, getEntityNames } from "./lib/entity-resolver";
import { saveClaims } from "./lib/store";
import type { HarvestedClaim } from "./lib/types";

const MAP_TEAM_ID = "6506fc68-25a5-4568-8a00-234bb9cb5ef6";

// ---------------------------------------------------------------------------
// Types for the GraphQL response
// ---------------------------------------------------------------------------

interface LinearLabel {
  name: string;
}

interface LinearComment {
  body: string;
  user: { name: string } | null;
  createdAt: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string } | null;
  labels: { nodes: LinearLabel[] };
  comments: { nodes: LinearComment[] };
}

interface IssuesResponse {
  issues: {
    nodes: LinearIssue[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISSUES_QUERY = `
query ($teamId: ID!, $after: String) {
  issues(
    filter: { team: { id: { eq: $teamId } } }
    first: 50
    after: $after
  ) {
    nodes {
      id
      identifier
      title
      description
      state { name }
      labels { nodes { name } }
      comments { nodes { body user { name } createdAt } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse "entity.field" or "entity > field" from issue title. */
function parseTitleHint(title: string): { entity: string | null; field: string | null } {
  // Pattern 1: "Entity.field_name" or "Entity.FieldName"
  const dotMatch = title.match(/^([A-Za-z_][\w]*)\.([\w]+)/);
  if (dotMatch) {
    return { entity: dotMatch[1], field: dotMatch[2] };
  }

  // Pattern 2: "Entity > field_name"
  const arrowMatch = title.match(/^([A-Za-z_][\w\s]*?)\s*>\s*([\w]+)/);
  if (arrowMatch) {
    return { entity: arrowMatch[1].trim(), field: arrowMatch[2] };
  }

  return { entity: null, field: null };
}

/** Determine milestone from issue labels. */
function determineMilestone(labels: LinearLabel[]): "M1" | "M2" | "M2.5" {
  const labelNames = labels.map((l) => l.name);
  if (labelNames.includes("M2.5")) return "M2.5";
  if (labelNames.includes("M2")) return "M2";
  return "M2";
}

/** Build text content from an issue's description and comments. */
function buildIssueText(issue: LinearIssue): string {
  const parts: string[] = [];

  parts.push(`Title: ${issue.title}`);

  if (issue.description) {
    parts.push(`\nDescription:\n${issue.description}`);
  }

  if (issue.comments.nodes.length > 0) {
    parts.push("\nComments:");
    for (const c of issue.comments.nodes) {
      const author = c.user?.name ?? "Unknown";
      parts.push(`\n[${author} - ${c.createdAt}]\n${c.body}`);
    }
  }

  return parts.join("\n");
}

/** Check if issue has substantive content. */
function isSubstantive(issue: LinearIssue): boolean {
  const descLen = issue.description?.length ?? 0;
  const hasComments = issue.comments.nodes.length > 0;
  return descLen > 50 || hasComments;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function fetchAllIssues(): Promise<LinearIssue[]> {
  const allIssues: LinearIssue[] = [];
  let cursor: string | null = null;
  let page = 1;

  while (true) {
    console.log(`Fetching page ${page}...`);
    const variables: Record<string, unknown> = { teamId: MAP_TEAM_ID };
    if (cursor) variables.after = cursor;

    const data = await linearGql<IssuesResponse>(ISSUES_QUERY, variables);
    allIssues.push(...data.issues.nodes);

    console.log(`  Got ${data.issues.nodes.length} issues (total: ${allIssues.length})`);

    if (!data.issues.pageInfo.hasNextPage || !data.issues.pageInfo.endCursor) break;
    cursor = data.issues.pageInfo.endCursor;
    page++;
  }

  return allIssues;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("Fetching Linear issues from MAP team...");
  const allIssues = await fetchAllIssues();
  console.log(`\nTotal issues fetched: ${allIssues.length}`);

  const substantive = allIssues.filter(isSubstantive);
  console.log(`Substantive issues (description > 50 chars or has comments): ${substantive.length}`);
  console.log(`Skipped: ${allIssues.length - substantive.length}`);

  if (dryRun) {
    console.log("\n--dry-run: skipping LLM extraction.");

    // Print some stats
    const withDesc = substantive.filter((i) => (i.description?.length ?? 0) > 50).length;
    const withComments = substantive.filter((i) => i.comments.nodes.length > 0).length;
    console.log(`  With description > 50 chars: ${withDesc}`);
    console.log(`  With comments: ${withComments}`);

    const milestones = { M1: 0, M2: 0, "M2.5": 0 };
    for (const issue of substantive) {
      milestones[determineMilestone(issue.labels.nodes)]++;
    }
    console.log(`  Milestones: M1=${milestones.M1}, M2=${milestones.M2}, M2.5=${milestones["M2.5"]}`);

    // Show a few sample titles
    console.log("\nSample issue titles:");
    for (const issue of substantive.slice(0, 10)) {
      const hint = parseTitleHint(issue.title);
      const hintStr = hint.entity ? ` [hint: ${hint.entity}.${hint.field}]` : "";
      console.log(`  ${issue.identifier}: ${issue.title}${hintStr}`);
    }
    return;
  }

  // Full extraction mode
  const entityNames = await getEntityNames();
  console.log(`Loaded ${entityNames.length} entity names for resolution.\n`);

  const allClaims: HarvestedClaim[] = [];

  for (let i = 0; i < substantive.length; i++) {
    const issue = substantive[i];
    const text = buildIssueText(issue);
    const milestone = determineMilestone(issue.labels.nodes);
    const sourceRef = `linear:${issue.identifier}`;

    console.log(`[${i + 1}/${substantive.length}] ${issue.identifier}: ${issue.title}`);

    const claims = await extractClaims(text, entityNames, "linear", sourceRef, milestone);

    // Resolve entity/field names using title hints as fallback
    const titleHint = parseTitleHint(issue.title);

    for (const claim of claims) {
      // Try to resolve entity from LLM output first
      if (claim.entityName) {
        const resolved = await resolveEntity(claim.entityName);
        if (resolved) {
          claim.entityName = resolved;
        } else if (titleHint.entity) {
          // LLM entity didn't resolve — try title hint
          const hintResolved = await resolveEntity(titleHint.entity);
          if (hintResolved) claim.entityName = hintResolved;
        }
      } else if (titleHint.entity) {
        // LLM returned null — use title hint
        const hintResolved = await resolveEntity(titleHint.entity);
        if (hintResolved) claim.entityName = hintResolved;
      }

      // Try to resolve field name
      if (claim.entityName) {
        if (claim.fieldName) {
          const resolved = await resolveField(claim.entityName, claim.fieldName);
          if (resolved) {
            claim.fieldName = resolved;
          } else if (titleHint.field) {
            const hintResolved = await resolveField(claim.entityName, titleHint.field);
            if (hintResolved) claim.fieldName = hintResolved;
          }
        } else if (titleHint.field) {
          const hintResolved = await resolveField(claim.entityName, titleHint.field);
          if (hintResolved) claim.fieldName = hintResolved;
        }
      }
    }

    console.log(`  -> ${claims.length} claims`);
    allClaims.push(...claims);

    // Rate limit between LLM calls
    if (i < substantive.length - 1) {
      await sleep(500);
    }
  }

  console.log(`\nExtraction complete. Total claims: ${allClaims.length}`);
  saveClaims("linear-claims.json", allClaims);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
