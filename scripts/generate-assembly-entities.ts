/**
 * Generate + eval M1 assembly entities via the batch runner (which handles
 * two-pass assembly generation with component entities).
 *
 * Usage:
 *   EXCLUDE_SOT=1 npx tsx scripts/generate-assembly-entities.ts          # all M1 assembly parents
 *   EXCLUDE_SOT=1 npx tsx scripts/generate-assembly-entities.ts borrower # specific entities
 *   npx tsx scripts/generate-assembly-entities.ts --eval-only            # skip generation
 *
 * Requires .env.local with API_KEY_ENCRYPTION_SECRET.
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, batchRun } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { listSotEntities } from "../src/lib/sot/yaml-parser";
import { createBatchRun, executeBatchRun } from "../src/lib/generation/batch-runner";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";

// Parse args
const args = process.argv.slice(2);
const evalOnly = args.includes("--eval-only");
const entityNames = args.filter((a) => !a.startsWith("--"));

// Resolve workspace
const ws = db.select().from(entity).limit(1).get();
if (!ws) { console.error("No entities in DB"); process.exit(1); }
const WORKSPACE_ID = ws.workspaceId;

// Find M1 assembly parent entities
const allSotEntities = listSotEntities();
const m1AssemblyParents = allSotEntities.filter(
  (e) => e.milestone === "m1" && e.isAssemblyParent
);

// Filter to requested entities, or use all M1 assembly parents
const targets = entityNames.length > 0
  ? m1AssemblyParents.filter((e) => entityNames.includes(e.name))
  : m1AssemblyParents;

if (targets.length === 0) {
  console.error("No matching M1 assembly entities found");
  if (entityNames.length > 0) {
    console.log("Available M1 assembly parents:", m1AssemblyParents.map((e) => e.name).join(", "));
  }
  process.exit(1);
}

// Resolve entity IDs from DB
const targetEntityIds: string[] = [];
const entityIdByName = new Map<string, string>();
for (const t of targets) {
  const ent = db
    .select({ id: entity.id })
    .from(entity)
    .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, t.name), eq(entity.side, "target")))
    .get();
  if (ent) {
    targetEntityIds.push(ent.id);
    entityIdByName.set(t.name, ent.id);
  } else {
    console.log(`  Skipping "${t.name}" — not in DB`);
  }
}

console.log(`\n${"=".repeat(70)}`);
console.log(`Assembly Entity ${evalOnly ? "Eval" : "Generate + Eval"} (EXCLUDE_SOT=${process.env.EXCLUDE_SOT || "0"})`);
console.log(`Entities: ${targets.map((t) => `${t.name} (${t.stagingComponents.length} components)`).join(", ")}`);
console.log(`${"=".repeat(70)}\n`);

async function main() {
  if (!evalOnly && targetEntityIds.length > 0) {
    // Use batch runner for proper assembly generation
    const usr = db.select().from(entity).limit(1).get();

    // Find user ID
    const { user } = await import("../src/lib/db/schema");
    const firstUser = db.select().from(user).limit(1).get();
    if (!firstUser) { console.error("No users in DB"); process.exit(1); }

    const { batchRunId, entities: batchEntities } = createBatchRun({
      workspaceId: WORKSPACE_ID,
      userId: firstUser.id,
      preferredProvider: "claude",
      outputFormat: "yaml",
      enableStructureClassification: true,
      entityIds: targetEntityIds,
    });

    console.log(`Batch run ${batchRunId}: ${batchEntities.length} entities, generating...\n`);

    await executeBatchRun(batchRunId, batchEntities, {
      workspaceId: WORKSPACE_ID,
      userId: firstUser.id,
      preferredProvider: "claude",
      outputFormat: "yaml",
      enableStructureClassification: true,
    });

    // Check batch run status
    const run = db.select().from(batchRun).where(eq(batchRun.id, batchRunId)).get();
    console.log(`\nBatch run status: ${run?.status}`);
    if (run?.completedEntities) console.log(`  Completed: ${run.completedEntities}, Failed: ${run.failedEntities || 0}`);
  }

  // Evaluate all target entities
  console.log(`\n${"=".repeat(70)}`);
  console.log("EVALUATION RESULTS");
  console.log(`${"=".repeat(70)}`);
  console.log(
    "Entity".padEnd(35),
    "Fields".padStart(7),
    "Scored".padStart(7),
    "Exact%".padStart(8),
    "Lenient%".padStart(9),
    "Match Types".padStart(10),
  );
  console.log("-".repeat(100));

  let totalScored = 0;
  let totalExact = 0;

  for (const t of targets) {
    const entId = entityIdByName.get(t.name);
    if (!entId) continue;

    const result = evaluateEntityMappings(WORKSPACE_ID, entId);
    if (!result) {
      console.log(`${t.name.padEnd(35)} (no SOT data)`);
      continue;
    }

    const byType: Record<string, number> = {};
    for (const fr of result.fieldResults) {
      byType[fr.matchType] = (byType[fr.matchType] || 0) + 1;
    }
    const typeStr = Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(" ");

    console.log(
      t.name.padEnd(35),
      String(result.totalFields).padStart(7),
      String(result.scoredFields).padStart(7),
      `${result.sourceExactPct.toFixed(1)}%`.padStart(8),
      `${result.sourceLenientPct.toFixed(1)}%`.padStart(9),
      ` ${typeStr}`,
    );

    totalScored += result.scoredFields;
    totalExact += result.sourceExactCount;

    // Show wrong fields
    const wrong = result.fieldResults.filter(
      (r) => !["NO_SOT", "SOT_NULL", "EXACT", "BOTH_NULL"].includes(r.matchType)
    );
    for (const wf of wrong) {
      console.log(`  ${wf.matchType.padEnd(10)} ${wf.field.padEnd(30)} gen=[${wf.genSources.join(", ") || "-"}] sot=[${wf.sotSources.join(", ")}]`);
    }
  }

  const avgExact = totalScored > 0 ? (totalExact / totalScored) * 100 : 0;
  console.log("-".repeat(100));
  console.log(`AGGREGATE: ${avgExact.toFixed(1)}% exact (${totalExact}/${totalScored} scored fields)`);
}

main().catch(console.error);
