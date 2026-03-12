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

  console.log(`\nStarting generation (direct per-entity, no retire)...\n`);

  // Use runGeneration directly with explicit fieldIds — this avoids the batch runner's
  // prepareEntityForRegeneration which retires ALL entity mappings before generating,
  // causing collateral damage when the LLM omits fields from its output.
  const { runGeneration } = await import("../src/lib/generation/runner");
  const { fieldMapping: fmSchema } = await import("../src/lib/db/schema");

  let totalCreated = 0;
  let totalErrors = 0;

  for (const [eId, fieldIds] of gapByEntity.entries()) {
    const e = entityById.get(eId);
    const name = e?.displayName || e?.name || eId;
    console.log(`  ${name} (${fieldIds.length} fields)...`);

    try {
      const result = await runGeneration({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        entityId: eId,
        generationType: "field_mapping",
        outputFormat: "yaml",
        preferredProvider: "claude",
        fieldIds,
      });

      if (result.status === "failed") {
        console.error(`    Failed: ${result.error}`);
        totalErrors++;
        continue;
      }

      // Persist field mappings from parsed output
      const parsed = result.parsedOutput;
      if (parsed?.fieldMappings?.length) {
        let created = 0;
        for (const fm of parsed.fieldMappings) {
          if (!fm.targetFieldId) continue;
          // Skip if this field already has an isLatest mapping (don't overwrite)
          const existing = await db.select({ id: fmSchema.id })
            .from(fmSchema)
            .where(and(
              eq(fmSchema.targetFieldId, fm.targetFieldId),
              eq(fmSchema.isLatest, true),
              isNull(fmSchema.transferId),
            ))
            .limit(1);
          if (existing.length > 0) continue;

          await db.insert(fmSchema).values({
            workspaceId: WORKSPACE_ID,
            targetFieldId: fm.targetFieldId,
            sourceEntityId: fm.sourceEntityId || null,
            sourceFieldId: fm.sourceFieldId || null,
            status: fm.status || "unreviewed",
            mappingType: fm.mappingType || "mapped",
            transform: fm.transform || null,
            reasoning: fm.reasoning || null,
            confidence: fm.confidence || null,
            generationId: result.generationId,
            isLatest: true,
            createdBy: "llm",
          });
          created++;
        }
        totalCreated += created;
        console.log(`    Created ${created} mappings (${parsed.fieldMappings.length} parsed, ${result.inputTokens}in/${result.outputTokens}out)`);
      } else {
        console.log(`    No mappings in output (${result.inputTokens}in/${result.outputTokens}out)`);
      }
    } catch (err) {
      console.error(`    Error: ${err instanceof Error ? err.message : err}`);
      totalErrors++;
    }
  }

  console.log(`\nDone. Created ${totalCreated} mappings, ${totalErrors} errors.`);

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
