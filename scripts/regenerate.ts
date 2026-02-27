/**
 * Regenerate mappings for loss_mitigation_loan_modification.
 * Clears existing latest mappings first, then runs generation + eval.
 *
 * Usage: npx tsx scripts/regenerate.ts
 */
import { readFileSync } from "fs";
// Load .env.local manually (no dotenv dependency)
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { fieldMapping, field, entity } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { startGeneration, executeGeneration } from "../src/lib/generation/runner";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";

const WORKSPACE_ID = "2ac4e497-1c82-4b0d-a86e-83bec30761c8";
const USER_ID = "4758a2e0-f727-4180-9f9b-6cd468e84598";
const ENTITY_ID = "07d0678a-637e-4917-9099-bd6ce09622dc";

async function main() {
  console.log("=== Regenerating loss_mitigation_loan_modification ===\n");

  // 1. Clear existing latest mappings so the generation creates fresh ones
  const targetFields = db
    .select({ id: field.id })
    .from(field)
    .where(eq(field.entityId, ENTITY_ID))
    .all();

  const fieldIds = targetFields.map((f) => f.id);
  console.log(`Clearing ${fieldIds.length} field mappings...`);

  for (const fid of fieldIds) {
    db.update(fieldMapping)
      .set({ isLatest: false })
      .where(
        and(
          eq(fieldMapping.targetFieldId, fid),
          eq(fieldMapping.isLatest, true),
        )
      )
      .run();
  }

  // 2. Start generation
  console.log("Starting generation (Opus)...");
  const start = Date.now();

  const { prepared } = startGeneration({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    entityId: ENTITY_ID,
    generationType: "batch",
    preferredProvider: "claude",
  });

  console.log(`Generation ${prepared.generationId} created, calling LLM...`);

  // 3. Execute (calls Claude)
  await executeGeneration(prepared);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Generation complete in ${elapsed}s\n`);

  // 4. Run SOT eval
  console.log("Running SOT evaluation...");
  const result = evaluateEntityMappings(WORKSPACE_ID, ENTITY_ID);
  if (!result) {
    console.log("No SOT data");
    return;
  }

  console.log(`\nScore: ${result.sourceExactPct}% exact (${result.sourceExactCount}/${result.scoredFields})`);
  console.log(`Lenient: ${result.sourceLenientPct}%`);
  console.log(`\nBaseline was: 65% exact (13/20)\n`);

  const delta = result.sourceExactPct - 65;
  if (delta > 0) {
    console.log(`*** IMPROVED by +${delta.toFixed(1)}% ***`);
  } else if (delta === 0) {
    console.log("No change from baseline.");
  } else {
    console.log(`Regressed by ${delta.toFixed(1)}%`);
  }

  // 5. Show per-field details for wrong fields
  console.log("\n--- Fields still wrong ---");
  for (const r of result.fieldResults) {
    if (r.matchType === "NO_SOT" || r.matchType === "SOT_NULL" || r.matchType === "EXACT" || r.matchType === "BOTH_NULL") continue;
    const gen = r.genSources.join(", ") || "(unmapped)";
    const sot = r.sotSources.join(", ") || "(none)";
    console.log(`${r.matchType.padEnd(12)} ${r.field.padEnd(50)} gen=${gen.padEnd(55)} sot=${sot}`);
  }

  const stillWrong = result.fieldResults.filter(
    (r) => !["NO_SOT", "SOT_NULL", "EXACT", "BOTH_NULL"].includes(r.matchType)
  ).length;
  if (stillWrong === 0) {
    console.log("(none — all scored fields are correct!)");
  }
}

main().catch(console.error);
