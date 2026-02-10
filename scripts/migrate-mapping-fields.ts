/**
 * Migration: Add mapping_type and assignee_id columns to field_mapping,
 * backfill mapping_type from old statuses, migrate statuses to new enum.
 *
 * Run: npx tsx scripts/migrate-mapping-fields.ts
 * Then: npm run db:push
 */

import postgres from "postgres";
import "dotenv/config";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });

async function run() {
  console.log("Starting mapping fields migration...\n");

  // Step 1: Add new columns (idempotent -- skip if already present)
  const columns = await client`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'field_mapping'
  ` as { column_name: string }[];
  const colNames = new Set(columns.map((c) => c.column_name));

  if (!colNames.has("mapping_type")) {
    console.log("Adding mapping_type column...");
    await client.unsafe("ALTER TABLE field_mapping ADD COLUMN mapping_type TEXT");
  } else {
    console.log("mapping_type column already exists, skipping.");
  }

  if (!colNames.has("assignee_id")) {
    console.log("Adding assignee_id column...");
    await client.unsafe('ALTER TABLE field_mapping ADD COLUMN assignee_id TEXT REFERENCES "user"(id) ON DELETE SET NULL');
  } else {
    console.log("assignee_id column already exists, skipping.");
  }

  // Step 2: Backfill mapping_type from old status values (before status migration)
  console.log("\nBackfilling mapping_type from old statuses...");

  const derivedResult = await client`
    UPDATE field_mapping SET mapping_type = 'derived' WHERE status = 'derived' AND mapping_type IS NULL
  `;
  console.log(`  derived -> mapping_type='derived': ${derivedResult.count} rows`);

  const defaultResult = await client`
    UPDATE field_mapping SET mapping_type = 'direct' WHERE status IN ('default', 'system_generated') AND mapping_type IS NULL
  `;
  console.log(`  default/system_generated -> mapping_type='direct': ${defaultResult.count} rows`);

  const mappedResult = await client`
    UPDATE field_mapping SET mapping_type = 'direct' WHERE status = 'mapped' AND mapping_type IS NULL
  `;
  console.log(`  mapped -> mapping_type='direct': ${mappedResult.count} rows`);

  // Step 3: Migrate statuses to new enum values
  console.log("\nMigrating statuses...");

  const closedResult = await client`
    UPDATE field_mapping SET status = 'fully_closed' WHERE status IN ('mapped', 'not_available', 'derived', 'default', 'system_generated')
  `;
  console.log(`  mapped/not_available/derived/default/system_generated -> fully_closed: ${closedResult.count} rows`);

  const clarificationResult = await client`
    UPDATE field_mapping SET status = 'open_comment_vt' WHERE status = 'requires_clarification'
  `;
  console.log(`  requires_clarification -> open_comment_vt: ${clarificationResult.count} rows`);

  // 'unmapped' stays as-is
  const unmappedCount = (await client`
    SELECT COUNT(*) as cnt FROM field_mapping WHERE status = 'unmapped'
  `)[0] as { cnt: number };
  console.log(`  unmapped (unchanged): ${unmappedCount.cnt} rows`);

  // Step 4: Create index on assignee_id
  console.log("\nCreating index on assignee_id...");
  try {
    await client.unsafe("CREATE INDEX IF NOT EXISTS mapping_assignee_idx ON field_mapping(assignee_id)");
    console.log("  Index created.");
  } catch (err) {
    console.log("  Index already exists or error:", (err as Error).message);
  }

  // Step 5: Verify
  console.log("\nVerification -- status distribution after migration:");
  const statusDist = await client`
    SELECT status, COUNT(*) as cnt FROM field_mapping GROUP BY status ORDER BY cnt DESC
  ` as { status: string; cnt: number }[];
  for (const row of statusDist) {
    console.log(`  ${row.status}: ${row.cnt}`);
  }

  console.log("\nmapping_type distribution:");
  const typeDist = await client`
    SELECT mapping_type, COUNT(*) as cnt FROM field_mapping GROUP BY mapping_type ORDER BY cnt DESC
  ` as { mapping_type: string | null; cnt: number }[];
  for (const row of typeDist) {
    console.log(`  ${row.mapping_type ?? "(null)"}: ${row.cnt}`);
  }

  console.log("\nMigration complete! Now run: npm run db:push");
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
