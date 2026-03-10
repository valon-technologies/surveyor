#!/usr/bin/env npx tsx --env-file=.env.local
/**
 * Unified AI review script.
 *
 * Run AI second-pass reviews on field mappings.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/review.ts --milestone M2.5 --dry-run
 *   npx tsx --env-file=.env.local scripts/review.ts --milestone M2.5 --missing-only
 *   npx tsx --env-file=.env.local scripts/review.ts --entity foreclosure --entity loan
 *   npx tsx --env-file=.env.local scripts/review.ts --transfer <id>
 *   npx tsx --env-file=.env.local scripts/review.ts --transfer <id> --fix-acdc
 *   npx tsx --env-file=.env.local scripts/review.ts --all --missing-only
 *
 * Flags:
 *   --milestone <M2|M2.5|M3>   Scope by milestone
 *   --entity <name>             Scope to entity (repeatable)
 *   --transfer <id>             Scope to transfer mappings
 *   --all                       All SDT mappings (no milestone filter)
 *   --missing-only              Only mappings without existing AI review
 *   --fix-acdc                  Transfer: re-review only mappings with ACDC sources
 *   --parallel <n>              Concurrency (default: 3)
 *   --model <id>                Override review model
 *   --dry-run                   Show count and cost estimate
 */

// ─── CLI parsing ───────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function getArgAll(flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) values.push(args[++i]);
  }
  return values;
}

const transferId = getArg("--transfer") || getArg("-t");
const milestone = getArg("--milestone");
const entityNames = getArgAll("--entity");
const parallel = parseInt(getArg("--parallel") || "3", 10);
const missingOnly = args.includes("--missing-only");
const fixAcdc = args.includes("--fix-acdc");
const allMappings = args.includes("--all");
const dryRun = args.includes("--dry-run");

if (!transferId && !milestone && entityNames.length === 0 && !allMappings) {
  console.error(`Usage: npx tsx --env-file=.env.local scripts/review.ts [options]

Scope (at least one required):
  --milestone <M2|M2.5|M3>   Scope by milestone
  --entity <name>             Scope to entity (repeatable)
  --transfer <id>             Scope to transfer
  --all                       All SDT mappings

Options:
  --missing-only              Only mappings without AI review
  --fix-acdc                  Transfer: re-review ACDC-contaminated reviews only
  --parallel <n>              Concurrency (default: 3)
  --dry-run                   Show count and cost estimate`);
  process.exit(1);
}

// ─── ACDC patterns for --fix-acdc ──────────────────────────
const ACDC_PATTERNS = [
  "LoanInfo", "EventDates", "DefaultWorkstations", "Step", "Investor",
  "ARM", "StopsFlagsAndIndicators", "Party", "BorrowerDemographics", "EConsent",
  "Nonborrower", "Courts", "LSMTPlan", "PropertyInsurance", "TaxLine",
  "FundingInfo", "Escrow", "BorrowerInfo",
];

// ─── Main ──────────────────────────────────────────────────
async function main() {
  const { db } = await import("../src/lib/db");
  const { entity, field, fieldMapping } = await import("../src/lib/db/schema");
  const { eq, and, inArray, isNull, isNotNull, sql } = await import("drizzle-orm");
  const { generateAiReview } = await import("../src/lib/generation/ai-review");

  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities"); process.exit(1); }
  const WORKSPACE_ID = firstEntity.workspaceId;

  // ─── Build mapping query conditions ────────────────────
  type MappingRow = { id: string; aiReview: unknown; entityName: string };
  let mappings: MappingRow[] = [];

  if (transferId) {
    // Transfer scope
    const rows = await db
      .select({
        id: fieldMapping.id,
        aiReview: fieldMapping.aiReview,
        entityName: entity.name,
      })
      .from(fieldMapping)
      .innerJoin(field, eq(field.id, fieldMapping.targetFieldId))
      .innerJoin(entity, eq(entity.id, field.entityId))
      .where(and(
        eq(fieldMapping.isLatest, true),
        eq(fieldMapping.transferId, transferId),
      ));
    mappings = rows;
  } else {
    // SDT scope — build entity filter
    let entityIds: string[] | undefined;

    if (entityNames.length > 0) {
      entityIds = [];
      for (const name of entityNames) {
        const [ent] = await db.select().from(entity)
          .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, name), eq(entity.side, "target")));
        if (!ent) { console.log(`Entity "${name}" not found — skipping`); continue; }
        entityIds.push(ent.id);
      }
      if (entityIds.length === 0) { console.error("No valid entities"); process.exit(1); }
    } else if (milestone) {
      const milestoneFields = await db
        .select({ entityId: field.entityId })
        .from(field)
        .where(eq(field.milestone, milestone));
      entityIds = Array.from(new Set(milestoneFields.map(f => f.entityId)));
    }
    // else --all: no entity filter

    const conditions = [
      eq(fieldMapping.isLatest, true),
      isNull(fieldMapping.transferId),
    ];
    if (entityIds) {
      conditions.push(inArray(field.entityId, entityIds));
    }
    if (milestone) {
      conditions.push(eq(field.milestone, milestone));
    }

    const rows = await db
      .select({
        id: fieldMapping.id,
        aiReview: fieldMapping.aiReview,
        entityName: entity.name,
      })
      .from(fieldMapping)
      .innerJoin(field, eq(field.id, fieldMapping.targetFieldId))
      .innerJoin(entity, eq(entity.id, field.entityId))
      .where(and(...conditions));
    mappings = rows;
  }

  // ─── Apply filters ────────────────────────────────────
  let toReview: string[] = [];

  if (fixAcdc && transferId) {
    // Only transfer mappings with ACDC sources in proposedUpdate
    for (const m of mappings) {
      const review = m.aiReview as Record<string, unknown> | null;
      const proposed = review?.proposedUpdate as Record<string, unknown> | null;
      if (!proposed) continue;
      const src = String(proposed.sourceEntityName || proposed.sourceFieldName || "");
      if (ACDC_PATTERNS.some(p => src.includes(p))) {
        toReview.push(m.id);
      }
    }
    console.log(`Found ${toReview.length} transfer reviews with ACDC sources`);
  } else if (missingOnly) {
    toReview = mappings.filter(m => !m.aiReview).map(m => m.id);
    console.log(`${mappings.length} total mappings, ${toReview.length} missing AI review`);
  } else {
    // Exclude accepted/excluded from review
    toReview = mappings.map(m => m.id);
    console.log(`${toReview.length} mappings to review`);
  }

  if (toReview.length === 0) {
    console.log("Nothing to review.");
    process.exit(0);
  }

  // ─── Cost estimate ────────────────────────────────────
  // Opus review: ~$0.10-0.15 per mapping (small prompt + 2K output)
  const estCostPer = 0.12;
  const estCost = toReview.length * estCostPer;
  console.log(`\nEstimated cost: ~$${estCost.toFixed(0)} (${toReview.length} × ~$${estCostPer}/review with Opus)`);

  // Group by entity for progress display
  const entityCounts = new Map<string, number>();
  for (const m of mappings) {
    if (toReview.includes(m.id)) {
      entityCounts.set(m.entityName, (entityCounts.get(m.entityName) || 0) + 1);
    }
  }
  console.log(`\nBy entity:`);
  for (const [name, count] of [...entityCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }

  if (dryRun) {
    console.log(`\n[dry-run] Would review ${toReview.length} mappings`);
    process.exit(0);
  }

  // ─── Execute reviews ──────────────────────────────────
  console.log(`\nRunning AI reviews (parallel=${parallel})...\n`);

  let reviewed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < toReview.length; i += parallel) {
    const batch = toReview.slice(i, i + parallel);
    const results = await Promise.allSettled(
      batch.map(id => generateAiReview(WORKSPACE_ID, id))
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        reviewed++;
      } else {
        errors++;
        if (r.status === "rejected") {
          console.error(`  Error: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
        }
      }
    }

    // Progress every 30 or at end
    if ((i + parallel) % 30 === 0 || i + parallel >= toReview.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  Progress: ${Math.min(i + parallel, toReview.length)}/${toReview.length} (${reviewed} ok, ${errors} errors) ${elapsed}s`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone: ${reviewed} reviewed, ${errors} errors, ${totalElapsed}s`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
