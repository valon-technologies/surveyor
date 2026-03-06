/**
 * Fill M2.5 mapping gaps — generate only for M2.5 fields that have NO mapping record.
 * Does NOT regenerate existing mappings. Uses the existing VDS Review batch runner.
 *
 * Usage: npx tsx scripts/fill-m25-gaps.ts [--dry-run] [--no-review]
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  const key = line.slice(0, idx).trim();
  const val = line.slice(idx + 1).trim().replace(/\r$/, "");
  process.env[key] = val;
}

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_REVIEW = process.argv.includes("--no-review");

async function main() {
  const { db } = await import("../src/lib/db");
  const { entity, field, fieldMapping, user } = await import("../src/lib/db/schema");
  const { eq, and, inArray, isNull } = await import("drizzle-orm");
  const { createBatchRun, executeBatchRun } = await import("../src/lib/generation/batch-runner");

  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities"); process.exit(1); }
  const WORKSPACE_ID = firstEntity.workspaceId;

  const [firstUser] = await db.select().from(user).limit(1);
  if (!firstUser) { console.error("No users"); process.exit(1); }
  const USER_ID = firstUser.id;

  // Find all M2.5 target fields
  const m25Fields = await db
    .select({ fieldId: field.id, entityId: field.entityId, name: field.name })
    .from(field)
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(and(eq(entity.side, "target"), eq(field.milestone, "M2.5")));

  // Find which ones already have VDS Review mappings (transferId IS NULL)
  const m25FieldIds = m25Fields.map(f => f.fieldId);
  const existingMappings = m25FieldIds.length > 0
    ? await db
        .select({ targetFieldId: fieldMapping.targetFieldId })
        .from(fieldMapping)
        .where(and(
          eq(fieldMapping.isLatest, true),
          isNull(fieldMapping.transferId),
          inArray(fieldMapping.targetFieldId, m25FieldIds),
        ))
    : [];
  const mappedIds = new Set(existingMappings.map(m => m.targetFieldId));

  // Find gap fields (no mapping record at all)
  const gapFields = m25Fields.filter(f => mappedIds.has(f.fieldId) === false);

  // Group by entity
  const gapByEntity = new Map<string, string[]>();
  for (const f of gapFields) {
    const list = gapByEntity.get(f.entityId) || [];
    list.push(f.fieldId);
    gapByEntity.set(f.entityId, list);
  }

  // Load entity names
  const targetEntities = await db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.side, "target")));
  const entityById = new Map(targetEntities.map(e => [e.id, e]));

  const gapEntityIds = Array.from(gapByEntity.keys());

  console.log(`\n=== M2.5 Gap Fill ===`);
  console.log(`Total M2.5 fields: ${m25Fields.length}`);
  console.log(`Already have mappings: ${mappedIds.size}`);
  console.log(`Gap fields (no mapping): ${gapFields.length}`);
  console.log(`Across ${gapEntityIds.length} entities:\n`);

  for (const [eId, fieldIds] of [...gapByEntity.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const e = entityById.get(eId);
    console.log(`  ${e?.displayName || e?.name || eId}: ${fieldIds.length} fields`);
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] Would generate ${gapEntityIds.length} entities, ${gapFields.length} fields`);
    process.exit(0);
  }

  console.log(`\nStarting generation...\n`);

  // Use the batch runner with "unmapped" status filter — since gap fields have
  // no mapping records, they'll be picked up as unmapped.
  // But the batch runner needs existing mapping records to know what's eligible...
  // Actually, the batch runner looks at fields and checks if they have mappings.
  // Fields WITHOUT mappings are treated as unmapped and included.
  const batchInput = {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    preferredProvider: "claude" as const,
    outputFormat: "yaml" as const,
    enableStructureClassification: true,
    entityIds: gapEntityIds,
    includeStatuses: ["unmapped"] as any,
    milestone: "M2.5",
  };

  const { batchRunId, entities: batches, totalFields } = await createBatchRun(batchInput);

  console.log(`Batch run ${batchRunId}: ${batches.length} entities, ${totalFields} eligible fields\n`);

  if (totalFields === 0) {
    console.log("No eligible fields found. The batch runner may not pick up fields without existing mapping records.");
    console.log("Trying alternative: generating per-entity with explicit field IDs...\n");

    // Alternative: use the runner directly for each entity with explicit field IDs
    const { startGeneration, executeGeneration, saveMappingsAndQuestions } = await import("../src/lib/generation/runner");

    let totalCreated = 0;
    let totalErrors = 0;

    for (const [eId, fieldIds] of gapByEntity.entries()) {
      const e = entityById.get(eId);
      const name = e?.displayName || e?.name || eId;
      console.log(`  ${name} (${fieldIds.length} fields)...`);

      try {
        const { startResult, prepared } = await startGeneration({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          entityId: eId,
          generationType: "field_mapping",
          outputFormat: "yaml",
          preferredProvider: "claude",
          fieldIds,
        });

        if (startResult.status === "skipped") {
          console.log(`    Skipped: ${startResult.reason}`);
          continue;
        }

        const genResult = await executeGeneration(prepared);
        const saved = await saveMappingsAndQuestions(prepared, WORKSPACE_ID);
        totalCreated += saved.mappingsCreated;
        console.log(`    Created ${saved.mappingsCreated} mappings`);
      } catch (err) {
        console.error(`    Error: ${err instanceof Error ? err.message : err}`);
        totalErrors++;
      }
    }

    console.log(`\nDone. Created ${totalCreated} mappings, ${totalErrors} errors.`);
  } else {
    await executeBatchRun(batchRunId, batches, batchInput);
    console.log(`\nBatch run complete.`);
  }

  // Pass 2: AI reviews
  if (SKIP_REVIEW) {
    console.log("Skipping AI review pass (--no-review)");
  } else {
    console.log(`\n=== Pass 2: AI Reviews ===`);
    // Skip for now — can be run separately
    console.log("Skipping AI reviews to save cost. Run generate-m25-all.ts for reviews.");
  }

  console.log(`\nDone.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
