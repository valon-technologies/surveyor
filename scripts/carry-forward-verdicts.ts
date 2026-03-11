#!/usr/bin/env npx tsx
/**
 * Carry forward reviewer verdicts from prior mapping versions to new ones
 * where the mapping hasn't changed (same source field, transform, mapping type).
 *
 * Usage:
 *   npx tsx scripts/carry-forward-verdicts.ts --transfer-id <id> [--dry-run]
 */

import { db } from "../src/lib/db";
import { fieldMapping } from "../src/lib/db/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const transferId = getArg("--transfer-id");
const dryRun = args.includes("--dry-run");

if (!transferId) {
  console.error("Usage: npx tsx scripts/carry-forward-verdicts.ts --transfer-id <id> [--dry-run]");
  process.exit(1);
}

async function main() {
  console.log(`=== Carry Forward Verdicts${dryRun ? " (DRY RUN)" : ""} ===\n`);

  // 1. Load all current (latest) mappings for this transfer
  const currentMappings = await db
    .select()
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.transferId, transferId!),
        eq(fieldMapping.isLatest, true),
      )
    );

  console.log(`Current mappings: ${currentMappings.length}`);

  // Filter to those with a parent (i.e., re-generated)
  const withParent = currentMappings.filter((m) => m.parentId);
  console.log(`With parent (re-generated): ${withParent.length}`);

  // Filter to those without existing verdicts
  const needsVerdicts = withParent.filter(
    (m) => !m.sourceVerdict && !m.transformVerdict && m.status === "unreviewed"
  );
  console.log(`Without verdicts (candidates): ${needsVerdicts.length}`);

  if (needsVerdicts.length === 0) {
    console.log("\nNo candidates — all mappings either have verdicts or no parent.");
    process.exit(0);
  }

  // 2. Load parent mappings
  const parentIds = [...new Set(needsVerdicts.map((m) => m.parentId!))];
  const parents = await db
    .select()
    .from(fieldMapping)
    .where(inArray(fieldMapping.id, parentIds));
  const parentById = new Map(parents.map((p) => [p.id, p]));

  console.log(`Parent mappings loaded: ${parentById.size}\n`);

  // 3. Compare and carry forward
  let carried = 0;
  let changed = 0;
  let noVerdict = 0;

  const updates: Array<{ id: string; sourceVerdict: string | null; sourceVerdictNotes: string | null; transformVerdict: string | null; transformVerdictNotes: string | null; status: string; notes: string | null }> = [];

  for (const m of needsVerdicts) {
    const parent = parentById.get(m.parentId!);
    if (!parent) continue;

    // Check if parent has any verdicts or reviewed status
    const parentHasVerdict = parent.sourceVerdict || parent.transformVerdict;
    const parentWasReviewed = ["accepted", "excluded", "punted", "needs_discussion"].includes(parent.status);

    if (!parentHasVerdict && !parentWasReviewed) {
      noVerdict++;
      continue;
    }

    // Compare mapping content
    const sameSource = m.sourceFieldId === parent.sourceFieldId;
    const sameTransform = (m.transform || "") === (parent.transform || "");
    const sameType = m.mappingType === parent.mappingType;

    if (sameSource && sameTransform && sameType) {
      updates.push({
        id: m.id,
        sourceVerdict: parent.sourceVerdict,
        sourceVerdictNotes: parent.sourceVerdictNotes,
        transformVerdict: parent.transformVerdict,
        transformVerdictNotes: parent.transformVerdictNotes,
        status: parent.status,
        notes: parent.notes,
      });
      carried++;
    } else {
      changed++;
      if (changed <= 5) {
        console.log(`  Changed: ${m.targetFieldId}`);
        if (!sameSource) console.log(`    Source: ${parent.sourceFieldId} → ${m.sourceFieldId}`);
        if (!sameTransform) console.log(`    Transform: "${parent.transform}" → "${m.transform}"`);
        if (!sameType) console.log(`    Type: ${parent.mappingType} → ${m.mappingType}`);
      }
    }
  }

  console.log(`\nResults:`);
  console.log(`  Carry forward (unchanged): ${carried}`);
  console.log(`  Mapping changed (skip): ${changed}`);
  console.log(`  Parent had no verdict: ${noVerdict}`);

  if (dryRun) {
    console.log("\nDry run — no changes made.");
    process.exit(0);
  }

  // 4. Apply updates
  const now = new Date().toISOString();
  for (const u of updates) {
    await db.update(fieldMapping)
      .set({
        sourceVerdict: u.sourceVerdict,
        sourceVerdictNotes: u.sourceVerdictNotes,
        transformVerdict: u.transformVerdict,
        transformVerdictNotes: u.transformVerdictNotes,
        status: u.status,
        notes: u.notes,
        updatedAt: now,
      })
      .where(eq(fieldMapping.id, u.id));
  }

  console.log(`\nApplied ${updates.length} verdict carry-forwards.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
