import { db } from "../src/lib/db";
import { entity, field, fieldMapping, question } from "../src/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { startGeneration, executeGeneration } from "../src/lib/generation/runner";
import { assembleContext } from "../src/lib/generation/context-assembler";

const WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";
const USER_ID = "61fa9316-4cfa-4859-9953-7ef93423eba8";
const ENTITY_ID = "a58ec5ba-643b-49f6-950a-a64d631fca87"; // borrower_co

async function main() {
  // 1. First, show what context the LLM will receive
  console.log("=== CONTEXT ASSEMBLY ===\n");

  // Get source entities for this workspace
  const sourceEntities = db
    .select({ name: entity.name })
    .from(entity)
    .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.side, "source")))
    .all();
  const sourceEntityNames = sourceEntities.map((e) => e.name);

  const ctx = assembleContext(WORKSPACE_ID, "borrower_co", 120_000, undefined, sourceEntityNames);

  console.log("Skills used:", ctx.skillsUsed.map((s) => s.name).join(", "));
  console.log("\nPrimary contexts:");
  for (const c of ctx.primaryContexts) {
    console.log(`  - ${c.name} (${c.tokenCount} tokens)`);
  }
  console.log("\nReference contexts:");
  for (const c of ctx.referenceContexts) {
    console.log(`  - ${c.name} (${c.tokenCount} tokens)`);
  }
  console.log("\nSupplementary contexts:");
  for (const c of ctx.supplementaryContexts) {
    console.log(`  - ${c.name} (${c.tokenCount} tokens)`);
  }
  console.log(`\nTotal tokens: ${ctx.totalTokens}`);

  // Check if BorrowerIndicator enum data is in any reference context
  const hasIndicatorEnum = ctx.referenceContexts.some((c) =>
    c.content.includes("BorrowerIndicator")
  );
  console.log(`\nBorrowerIndicator enum in context: ${hasIndicatorEnum ? "YES" : "NO"}`);

  // Check if BORROWERDEMOGRAPHICS ENUMS is included
  const hasBDEnums = ctx.referenceContexts.some((c) =>
    c.name.includes("BORROWERDEMOGRAPHICS")
  );
  console.log(`BORROWERDEMOGRAPHICS ENUMS included: ${hasBDEnums ? "YES" : "NO"}`);

  // Check if STOPSFLAGSANDINDICATORS ENUMS is included (for CoMtgrGenerationalSfxCode)
  const hasSFIEnums = ctx.referenceContexts.some((c) =>
    c.name.includes("STOPSFLAGSANDINDICATORS")
  );
  console.log(`STOPSFLAGSANDINDICATORS ENUMS included: ${hasSFIEnums ? "YES" : "NO"}`);

  // 2. Now run the actual generation
  console.log("\n\n=== RUNNING GENERATION ===\n");

  // Force all fields by passing explicit fieldIds (bypasses "already mapped" filter)
  const allFieldIds = db
    .select({ id: field.id })
    .from(field)
    .where(eq(field.entityId, ENTITY_ID))
    .all()
    .map((f) => f.id);
  console.log(`Forcing regeneration of ${allFieldIds.length} fields\n`);

  const { prepared } = startGeneration({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    entityId: ENTITY_ID,
    generationType: "field_mapping",
    preferredProvider: "claude",
    outputFormat: "yaml",
    fieldIds: allFieldIds,
  });

  console.log(`Generation ID: ${prepared.generationId}`);
  console.log("Calling LLM...\n");

  await executeGeneration(prepared);

  // 3. Read and display the result
  const gen = db
    .select()
    .from(entity)
    .where(eq(entity.id, ENTITY_ID))
    .get();

  // Read generation result
  const { generation } = await import("../src/lib/db/schema");
  const genResult = db
    .select()
    .from(generation)
    .where(eq(generation.id, prepared.generationId))
    .get();

  if (!genResult) {
    console.error("Generation not found!");
    return;
  }

  console.log(`Status: ${genResult.status}`);

  if (genResult.outputRaw) {
    // Extract just the sources/filters and questions sections
    const raw = genResult.outputRaw as string;

    // Show sources section (contains filters)
    const sourcesMatch = raw.match(/sources:[\s\S]*?(?=\n(?:joins|columns):)/);
    if (sourcesMatch) {
      console.log("\n--- SOURCES (filter section) ---");
      console.log(sourcesMatch[0]);
    }

    // Show questions section
    const questionsMatch = raw.match(/questions:[\s\S]*$/);
    if (questionsMatch) {
      console.log("\n--- QUESTIONS ---");
      console.log(questionsMatch[0]);
    } else {
      console.log("\n--- NO QUESTIONS GENERATED ---");
    }
  }

  // 4. Check what questions would be created
  const parsed = genResult.outputParsed as any;
  if (parsed?.questions?.length) {
    console.log(`\n=== LLM GENERATED ${parsed.questions.length} QUESTIONS ===`);
    for (const q of parsed.questions) {
      console.log(`  [${q.priority}] ${q.targetFieldName || "(entity-level)"}: ${q.questionText}`);
    }
  } else {
    console.log("\n=== NO QUESTIONS IN PARSED OUTPUT ===");
  }
}

main().catch(console.error);
