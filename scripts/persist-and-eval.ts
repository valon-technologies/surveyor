/**
 * Persist field mappings from last generation output, then run SOT eval.
 *
 * Usage: env $(grep -v '^#' .env.local | xargs) npx tsx scripts/persist-and-eval.ts
 */

import { db } from "../src/lib/db";
import { generation, fieldMapping, sotEvaluation } from "../src/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";

const WORKSPACE_ID = "2ac4e497-1c82-4b0d-a86e-83bec30761c8";
const ENTITY_ID = "07d0678a-637e-4917-9099-bd6ce09622dc";

// Find latest completed generation
const gen = db
  .select()
  .from(generation)
  .where(
    and(
      eq(generation.entityId, ENTITY_ID),
      eq(generation.status, "completed"),
    )
  )
  .orderBy(desc(generation.createdAt))
  .get();

if (!gen) {
  console.log("No completed generation found.");
  process.exit(1);
}

console.log(`Using generation: ${gen.id}`);

// Check if mappings already exist
const existing = db
  .select({ id: fieldMapping.id })
  .from(fieldMapping)
  .where(eq(fieldMapping.generationId, gen.id))
  .all();

if (existing.length > 0) {
  console.log(`${existing.length} field mappings already exist for this generation.`);
} else {
  // Persist field mappings from outputParsed
  const outputParsed = gen.outputParsed as Record<string, unknown> | null;
  const fms = (outputParsed?.fieldMappings ?? []) as Array<Record<string, unknown>>;

  let persisted = 0;
  for (const fm of fms) {
    if (!fm.targetFieldId) continue;

    db.insert(fieldMapping)
      .values({
        id: crypto.randomUUID(),
        workspaceId: WORKSPACE_ID,
        targetFieldId: fm.targetFieldId as string,
        status: (fm.status as string) || "unreviewed",
        mappingType: (fm.mappingType as string) || null,
        sourceEntityId: (fm.sourceEntityId as string) || null,
        sourceFieldId: (fm.sourceFieldId as string) || null,
        transform: (fm.transform as string) || null,
        defaultValue: (fm.defaultValue as string) || null,
        enumMapping: (fm.enumMapping as Record<string, string>) || null,
        reasoning: (fm.reasoning as string) || null,
        confidence: (fm.confidence as string) || null,
        notes: (fm.reviewComment as string) || (fm.notes as string) || null,
        createdBy: "llm",
        generationId: gen.id,
        version: 1,
        isLatest: true,
      })
      .run();
    persisted++;
  }
  console.log(`Persisted ${persisted} field mappings.`);
}

// Run evaluation
console.log("\n=== SOT Evaluation ===\n");

const evalResult = evaluateEntityMappings(WORKSPACE_ID, ENTITY_ID);
if (!evalResult) {
  console.log("No SOT data available for this entity.");
  process.exit(1);
}

console.log(`Entity: ${evalResult.entityName}`);
console.log(`Total fields: ${evalResult.totalFields}`);
console.log(`Scored fields: ${evalResult.scoredFields} (have SOT data)`);
console.log(`Source EXACT:   ${evalResult.sourceExactCount}/${evalResult.scoredFields} (${evalResult.sourceExactPct}%)`);
console.log(`Source LENIENT: ${evalResult.sourceLenientCount}/${evalResult.scoredFields} (${evalResult.sourceLenientPct}%)`);

// Persist evaluation
const evalId = crypto.randomUUID();
db.insert(sotEvaluation)
  .values({
    id: evalId,
    workspaceId: WORKSPACE_ID,
    entityId: ENTITY_ID,
    generationId: evalResult.generationId,
    totalFields: evalResult.totalFields,
    scoredFields: evalResult.scoredFields,
    sourceExactCount: evalResult.sourceExactCount,
    sourceLenientCount: evalResult.sourceLenientCount,
    sourceExactPct: evalResult.sourceExactPct,
    sourceLenientPct: evalResult.sourceLenientPct,
    fieldResults: evalResult.fieldResults,
  })
  .run();

console.log(`\nEvaluation saved: ${evalId}`);

// Per-field breakdown
console.log("\n=== Per-field results ===\n");
const scorable = evalResult.fieldResults.filter(
  (r) => r.matchType !== "NO_SOT" && r.matchType !== "SOT_NULL"
);
for (const r of scorable) {
  const pad = r.field.padEnd(50);
  const genStr = r.genSources.length > 0 ? r.genSources.join(", ") : "(none)";
  const sotStr = r.sotSources.length > 0 ? r.sotSources.join(", ") : "(none)";
  console.log(`${pad} ${r.matchType.padEnd(10)} gen=${genStr}`);
  console.log(`${"".padEnd(50)} ${"".padEnd(10)} sot=${sotStr}`);
}
