/**
 * Re-run AI reviews for transfer mappings where the review incorrectly
 * proposed ACDC sources instead of flat file sources.
 *
 * Usage: npx tsx --env-file=.env.local scripts/fix-transfer-ai-reviews.ts
 */
import { db } from "../src/lib/db";
import { fieldMapping, field, entity, transfer } from "../src/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { generateAiReview } from "../src/lib/generation/ai-review";

const ACDC_PATTERNS = [
  "LoanInfo", "EventDates", "DefaultWorkstations", "Step", "Investor",
  "ARM", "StopsFlagsAndIndicators", "Party", "BorrowerDemographics", "EConsent",
  "Nonborrower", "Courts", "LSMTPlan", "PropertyInsurance", "TaxLine",
  "FundingInfo", "Escrow", "BorrowerInfo",
];

async function main() {
  // Get workspace ID
  const [first] = await db.select().from(entity).limit(1);
  if (!first) { console.error("No entities"); process.exit(1); }
  const WORKSPACE_ID = first.workspaceId;

  // Find transfer mappings with AI reviews
  const mappings = await db.select({
    id: fieldMapping.id,
    aiReview: fieldMapping.aiReview,
    transferId: fieldMapping.transferId,
  })
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.isLatest, true),
        isNotNull(fieldMapping.transferId),
        isNotNull(fieldMapping.aiReview),
      )
    );

  // Filter to ones with ACDC sources in proposedUpdate
  const toFix: string[] = [];
  for (const m of mappings) {
    const review = m.aiReview as Record<string, unknown> | null;
    const proposed = review?.proposedUpdate as Record<string, unknown> | null;
    if (!proposed) continue;

    const src = String(proposed.sourceEntityName || proposed.sourceFieldName || "");
    if (ACDC_PATTERNS.some(p => src.includes(p))) {
      toFix.push(m.id);
    }
  }

  console.log(`Found ${toFix.length} transfer AI reviews with ACDC sources`);
  console.log(`Running with transfer-aware prompt...\n`);

  let fixed = 0;
  let errors = 0;
  const PARALLEL = 3;

  for (let i = 0; i < toFix.length; i += PARALLEL) {
    const batch = toFix.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(id => generateAiReview(WORKSPACE_ID, id))
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        fixed++;
      } else {
        errors++;
      }
    }

    if ((i + PARALLEL) % 30 === 0 || i + PARALLEL >= toFix.length) {
      console.log(`  Progress: ${Math.min(i + PARALLEL, toFix.length)}/${toFix.length} (${fixed} fixed, ${errors} errors)`);
    }
  }

  console.log(`\nDone: ${fixed} fixed, ${errors} errors`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
