/**
 * Regenerate ALL M2.5 field mappings + AI reviews.
 * Re-runs generation for every entity that has M2.5 fields, regardless of
 * whether mappings already exist.  Old mappings are preserved (isLatest=false).
 *
 * Usage: npx tsx scripts/generate-m25-all.ts
 *
 * Options:
 *   --dry-run    Show what would be generated without running
 *   --no-review  Skip AI review pass
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
  // Dynamic imports so env vars are set before module init
  const { db } = await import("../src/lib/db");
  const { entity, field, fieldMapping, user } = await import("../src/lib/db/schema");
  const { eq, and, sql, inArray } = await import("drizzle-orm");
  const { createBatchRun, executeBatchRun } = await import("../src/lib/generation/batch-runner");

  // Resolve workspace + user
  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities"); process.exit(1); }
  const WORKSPACE_ID = firstEntity.workspaceId;

  const [firstUser] = await db.select().from(user).limit(1);
  if (!firstUser) { console.error("No users"); process.exit(1); }
  const USER_ID = firstUser.id;

  // Find all entities with M2.5 fields
  const m25FieldRows = await db
    .select({
      entityId: field.entityId,
      fieldId: field.id,
    })
    .from(field)
    .where(eq(field.milestone, "M2.5"));

  // Group by entity
  const entityM25Map = new Map<string, number>();
  for (const row of m25FieldRows) {
    entityM25Map.set(row.entityId, (entityM25Map.get(row.entityId) || 0) + 1);
  }

  // Load entity details
  const targetEntities = await db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.side, "target")));

  const m25Entities = targetEntities
    .filter((e) => entityM25Map.has(e.id))
    .sort((a, b) => (entityM25Map.get(b.id) || 0) - (entityM25Map.get(a.id) || 0));

  // Count existing mappings for M2.5 fields
  const m25FieldIds = m25FieldRows.map((r) => r.fieldId);
  const existingMappings = m25FieldIds.length > 0
    ? await db
        .select({ targetFieldId: fieldMapping.targetFieldId })
        .from(fieldMapping)
        .where(and(
          eq(fieldMapping.isLatest, true),
          inArray(fieldMapping.targetFieldId, m25FieldIds),
        ))
    : [];
  const mappedFieldIds = new Set(existingMappings.map((m) => m.targetFieldId));

  const totalM25 = m25FieldRows.length;
  const totalExisting = mappedFieldIds.size;

  console.log(`\n=== M2.5 Full Regeneration ===`);
  console.log(`${m25Entities.length} entities with M2.5 fields`);
  console.log(`${totalM25} total M2.5 fields (${totalExisting} have existing mappings)`);
  console.log(`All existing mappings will be superseded (preserved as isLatest=false)\n`);

  for (const e of m25Entities) {
    const name = e.displayName || e.name;
    const m25Count = entityM25Map.get(e.id) || 0;
    const entityFieldIds = m25FieldRows.filter((r) => r.entityId === e.id).map((r) => r.fieldId);
    const mapped = entityFieldIds.filter((id) => mappedFieldIds.has(id)).length;
    const tag = mapped > 0 ? `${mapped}/${m25Count} mapped -> regenerate` : `${m25Count} unmapped`;
    console.log(`  ${name}: ${tag}`);
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] Would generate ${m25Entities.length} entities, ${totalM25} M2.5 fields`);
    process.exit(0);
  }

  console.log(`\nStarting generation...\n`);

  const entityIds = m25Entities.map((e) => e.id);

  // Create and execute batch run
  // includeStatuses covers everything except "accepted" — this will regenerate
  // unreviewed, punted, needs_discussion, excluded, AND unmapped fields
  const batchInput = {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    preferredProvider: "claude" as const,
    outputFormat: "yaml" as const,
    enableStructureClassification: true,
    entityIds,
    includeStatuses: ["unmapped", "unreviewed", "punted", "needs_discussion", "excluded"] as any,
    milestone: "M2.5",
  };

  const { batchRunId, entities: batches, totalFields } = await createBatchRun(batchInput);

  console.log(`Batch run ${batchRunId}: ${batches.length} entities, ${totalFields} eligible fields\n`);

  await executeBatchRun(batchRunId, batches, batchInput);

  // Pass 2: AI reviews
  if (!SKIP_REVIEW) {
    console.log(`\n=== Pass 2: AI Reviews ===`);
    const { generateAiReview } = await import("../src/lib/generation/ai-review");

    let reviewCount = 0;
    let reviewErrors = 0;

    for (const batch of batches) {
      // Get all latest mappings that need AI review
      const mappings = await db
        .select({ id: fieldMapping.id })
        .from(fieldMapping)
        .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
        .where(
          and(
            eq(field.entityId, batch.entityId),
            eq(fieldMapping.isLatest, true),
            eq(fieldMapping.batchRunId, batchRunId),
            sql`${fieldMapping.aiReview} IS NULL`,
            sql`${fieldMapping.status} NOT IN ('excluded', 'accepted')`,
          )
        );

      if (mappings.length === 0) continue;
      console.log(`[${batch.entityName}] ${mappings.length} mappings need AI review`);

      for (const m of mappings) {
        try {
          await generateAiReview(m.id, WORKSPACE_ID);
          reviewCount++;
        } catch (err) {
          reviewErrors++;
          console.log(`  ✗ Review failed for ${m.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    console.log(`\nAI reviews: ${reviewCount} generated, ${reviewErrors} errors`);
  }

  console.log(`\nDone.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
