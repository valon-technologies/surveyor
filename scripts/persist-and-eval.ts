/**
 * Persist field mappings from the latest generation's output_parsed and run SOT eval.
 *
 * Usage: npx tsx scripts/persist-and-eval.ts
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { generation, fieldMapping, field } from "../src/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";

const WORKSPACE_ID = "2ac4e497-1c82-4b0d-a86e-83bec30761c8";
const USER_ID = "4758a2e0-f727-4180-9f9b-6cd468e84598";
const ENTITY_ID = "07d0678a-637e-4917-9099-bd6ce09622dc";

const gen = db
  .select()
  .from(generation)
  .where(and(
    eq(generation.workspaceId, WORKSPACE_ID),
    eq(generation.entityId, ENTITY_ID),
    eq(generation.status, "completed"),
  ))
  .orderBy(desc(generation.createdAt))
  .limit(1)
  .get();

if (!gen || !gen.outputParsed) {
  console.log("No completed generation found");
  process.exit(1);
}

const parsed = gen.outputParsed as any;
console.log(`Generation ${gen.id} from ${gen.createdAt}`);
console.log(`Output has ${parsed.fieldMappings.length} mappings\n`);

// Clear existing latest
const targetFields = db.select({ id: field.id }).from(field).where(eq(field.entityId, ENTITY_ID)).all();
for (const tf of targetFields) {
  db.update(fieldMapping)
    .set({ isLatest: false })
    .where(and(eq(fieldMapping.targetFieldId, tf.id), eq(fieldMapping.isLatest, true)))
    .run();
}
console.log(`Cleared ${targetFields.length} field isLatest flags`);

// Persist new mappings
let persisted = 0;
for (const fm of parsed.fieldMappings) {
  if (!fm.targetFieldId) continue;
  db.insert(fieldMapping).values({
    id: crypto.randomUUID(),
    workspaceId: WORKSPACE_ID,
    targetFieldId: fm.targetFieldId,
    status: "unreviewed",
    mappingType: fm.mappingType || "direct",
    sourceEntityId: fm.sourceEntityId || null,
    sourceFieldId: fm.sourceFieldId || null,
    transform: fm.transform || null,
    defaultValue: fm.defaultValue || null,
    enumMapping: fm.enumMapping || null,
    reasoning: fm.reasoning || null,
    confidence: fm.confidence || null,
    notes: fm.notes || fm.reviewComment || null,
    createdBy: "llm",
    assigneeId: USER_ID,
    generationId: gen.id,
    version: 1,
    isLatest: true,
  }).run();
  persisted++;
}
console.log(`Persisted ${persisted} field mappings\n`);

// SOT eval
console.log("Running SOT evaluation...");
const result = evaluateEntityMappings(WORKSPACE_ID, ENTITY_ID);
if (!result) { console.log("No SOT data"); process.exit(1); }

console.log(`\nScore: ${result.sourceExactPct}% exact (${result.sourceExactCount}/${result.scoredFields})`);
console.log(`Lenient: ${result.sourceLenientPct}%`);
console.log(`\nBaseline was: 65% exact (13/20)\n`);

const delta = result.sourceExactPct - 65;
if (delta > 0) console.log(`*** IMPROVED by +${delta.toFixed(1)}% ***`);
else if (delta === 0) console.log("No change from baseline.");
else console.log(`Regressed by ${delta.toFixed(1)}%`);

console.log("\n--- Fields still wrong ---");
for (const r of result.fieldResults) {
  if (["NO_SOT", "SOT_NULL", "EXACT", "BOTH_NULL"].includes(r.matchType)) continue;
  const g = r.genSources.join(", ") || "(unmapped)";
  const s = r.sotSources.join(", ") || "(none)";
  console.log(`${r.matchType.padEnd(12)} ${r.field.padEnd(50)} gen=${g.padEnd(55)} sot=${s}`);
}
const wrong = result.fieldResults.filter(r => !["NO_SOT","SOT_NULL","EXACT","BOTH_NULL"].includes(r.matchType)).length;
if (wrong === 0) console.log("(none - all scored fields are correct!)");
