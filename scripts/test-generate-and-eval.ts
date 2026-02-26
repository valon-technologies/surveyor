/**
 * Test script: Generate mappings for loss_mitigation_loan_modification,
 * persist field mappings, then run SOT evaluation.
 *
 * Usage: env $(grep -v '^#' .env.local | xargs) npx tsx scripts/test-generate-and-eval.ts
 *
 * Pass --eval-only to skip generation and just run evaluation on existing mappings.
 */

import { runGeneration } from "../src/lib/generation/runner";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";
import { db } from "../src/lib/db";
import { generation, fieldMapping, sotEvaluation } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const WORKSPACE_ID = "2ac4e497-1c82-4b0d-a86e-83bec30761c8";
const USER_ID = "4758a2e0-f727-4180-9f9b-6cd468e84598";
const ENTITY_ID = "07d0678a-637e-4917-9099-bd6ce09622dc";

const evalOnly = process.argv.includes("--eval-only");

interface ParsedFieldMapping {
  targetFieldName: string;
  targetFieldId: string | null;
  sourceEntityId: string | null;
  sourceFieldId: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  mappingType: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string> | null;
  reasoning: string | null;
  confidence: string | null;
  notes: string | null;
  reviewComment: string | null;
  status: string | null;
}

async function main() {
  let generationId: string | null = null;

  if (!evalOnly) {
    console.log("=== Step 1: Generate mappings ===");
    console.log("Entity: loss_mitigation_loan_modification");
    console.log("Format: yaml\n");

    const genResult = await runGeneration({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      generationType: "field_mapping",
      outputFormat: "yaml",
    });

    console.log(`Generation ${genResult.generationId}: ${genResult.status}`);
    console.log(`  Provider: ${genResult.provider} / ${genResult.model}`);
    console.log(`  Tokens: ${genResult.inputTokens} in / ${genResult.outputTokens} out`);
    console.log(`  Duration: ${(genResult.durationMs / 1000).toFixed(1)}s`);
    if (genResult.error) {
      console.log(`  Error: ${genResult.error}`);
      process.exit(1);
    }
    generationId = genResult.generationId;

    // Persist field mappings from parsed output (batch runner normally does this)
    console.log("\n=== Step 1b: Persist field mappings ===\n");

    const gen = db.select().from(generation).where(eq(generation.id, generationId)).get();
    const outputParsed = gen?.outputParsed as { fieldMappings?: ParsedFieldMapping[] } | null;
    const fieldMappings = outputParsed?.fieldMappings ?? [];

    let persisted = 0;
    for (const fm of fieldMappings) {
      if (!fm.targetFieldId) continue;

      db.insert(fieldMapping)
        .values({
          id: crypto.randomUUID(),
          workspaceId: WORKSPACE_ID,
          targetFieldId: fm.targetFieldId,
          status: fm.status || "unreviewed",
          mappingType: fm.mappingType,
          sourceEntityId: fm.sourceEntityId,
          sourceFieldId: fm.sourceFieldId,
          transform: fm.transform,
          defaultValue: fm.defaultValue,
          enumMapping: fm.enumMapping,
          reasoning: fm.reasoning,
          confidence: fm.confidence,
          notes: fm.reviewComment || fm.notes,
          createdBy: "llm",
          generationId,
          version: 1,
          isLatest: true,
        }).run();
      persisted++;
    }
    console.log(`Persisted ${persisted} field mappings.`);
  }

  console.log("\n=== Step 2: Run SOT evaluation ===\n");

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
  const scorable = evalResult.fieldResults.filter(r =>
    r.matchType !== "NO_SOT" && r.matchType !== "SOT_NULL"
  );
  for (const r of scorable) {
    const pad = r.field.padEnd(50);
    const genStr = r.genSources.length > 0 ? r.genSources.join(", ") : "(none)";
    const sotStr = r.sotSources.length > 0 ? r.sotSources.join(", ") : "(none)";
    console.log(`${pad} ${r.matchType.padEnd(10)} gen=${genStr}`);
    console.log(`${"".padEnd(50)} ${"".padEnd(10)} sot=${sotStr}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
