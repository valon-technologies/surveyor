/**
 * Auto-give verdicts on wrong fields using SOT as ground truth.
 * Simulates reviewer corrections for testing the feedback loop at scale.
 *
 * Usage:
 *   npx tsx scripts/auto-verdicts.ts                    # all 7 target entities
 *   npx tsx scripts/auto-verdicts.ts loan foreclosure   # specific entities
 *
 * Requires .env.local (for entity-knowledge rebuild which may use API key).
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, fieldMapping, context } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";
import { extractVerdictLearning } from "../src/lib/generation/mapping-learning";

const DEFAULT_ENTITIES = [
  "loan",
  "foreclosure",
  "borrower",
  "escrow_analysis",
  "loss_mitigation_application",
  "loss_mitigation_plan",
  "bankruptcy_case",
];

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const targets = args.length > 0 ? args : DEFAULT_ENTITIES;

const ws = db.select().from(entity).limit(1).get();
if (!ws) { console.error("No entities in DB"); process.exit(1); }
const WORKSPACE_ID = ws.workspaceId;

async function processEntity(name: string) {
  const ent = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, name), eq(entity.side, "target")))
    .get();

  if (!ent) { console.log(`  ⚠ "${name}" not found — skipping`); return 0; }

  // Run eval to get wrong fields
  const result = evaluateEntityMappings(WORKSPACE_ID, ent.id);
  if (!result) { console.log(`  No SOT data — skipping`); return 0; }

  const wrongFields = result.fieldResults.filter(
    (r: any) => !["NO_SOT", "SOT_NULL", "EXACT", "BOTH_NULL"].includes(r.matchType)
  );

  if (wrongFields.length === 0) {
    console.log(`  All scored fields correct — no verdicts needed`);
    return 0;
  }

  // Get latest mappings for this entity
  const targetFields = db.select({ id: field.id, name: field.name }).from(field).where(eq(field.entityId, ent.id)).all();
  const fieldNameToId = new Map(targetFields.map((f) => [f.name, f.id]));

  let verdictCount = 0;
  for (const wf of wrongFields) {
    const targetFieldId = fieldNameToId.get(wf.field);
    if (!targetFieldId) continue;

    // Find the latest mapping for this field
    const mapping = db
      .select()
      .from(fieldMapping)
      .where(and(eq(fieldMapping.targetFieldId, targetFieldId), eq(fieldMapping.isLatest, true)))
      .get();

    if (!mapping) continue;

    // Determine verdict type and notes based on match type
    let verdict: string;
    let notes: string;

    if (wf.matchType === "NO_GEN") {
      verdict = "missing_source";
      notes = `REQUIRED: Map to ${wf.sotSources.join(", ")}. This is a verified correction.`;
    } else if (wf.matchType === "DISJOINT") {
      // Check if it's a table mismatch or field mismatch
      const genTables = wf.genSources.map((s: string) => s.split(".")[0]);
      const sotTables = wf.sotSources.map((s: string) => s.split(".")[0]);
      const tableMatch = genTables.some((t: string) => sotTables.includes(t));
      verdict = tableMatch ? "wrong_field" : "wrong_table";
      notes = `REQUIRED: Use ${wf.sotSources.join(", ")} (not ${wf.genSources.join(", ")}). This is a verified correction — do not override.`;
    } else if (wf.matchType === "OVERLAP" || wf.matchType === "SUBSET") {
      verdict = "wrong_field";
      notes = `REQUIRED: Must include all of: ${wf.sotSources.join(", ")} (currently only: ${wf.genSources.join(", ")}). Verified correction.`;
    } else if (wf.matchType === "SUPERSET") {
      verdict = "wrong_field";
      notes = `REQUIRED: Use only ${wf.sotSources.join(", ")} (not ${wf.genSources.join(", ")}). Extra sources are incorrect. Verified correction.`;
    } else {
      continue;
    }

    db.update(fieldMapping)
      .set({
        sourceVerdict: verdict,
        sourceVerdictNotes: notes,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(fieldMapping.id, mapping.id))
      .run();

    extractVerdictLearning(WORKSPACE_ID, mapping.id);
    verdictCount++;
    console.log(`    ${verdict.padEnd(15)} ${wf.field}`);
  }

  // Check Entity Knowledge was rebuilt
  const ek = db
    .select({ content: context.content })
    .from(context)
    .where(and(eq(context.workspaceId, WORKSPACE_ID), eq(context.subcategory, "entity_knowledge"), eq(context.entityId, ent.id)))
    .get();

  if (ek) {
    const lines = ek.content?.split("\n").length ?? 0;
    console.log(`  Entity Knowledge: ${lines} lines`);
  }

  return verdictCount;
}

async function main() {
  console.log(`\nAuto-Verdicts (using SOT as ground truth)\n`);

  let totalVerdicts = 0;
  for (const name of targets) {
    console.log(`[${name}]`);
    totalVerdicts += await processEntity(name);
  }

  console.log(`\nTotal verdicts given: ${totalVerdicts}`);
  console.log("Run multi-entity-eval.ts again to measure improvement.");
}

main().catch(console.error);
