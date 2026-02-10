/**
 * Migration: Add mapping_type and assignee_id columns to field_mapping,
 * backfill mapping_type from old statuses, migrate statuses to new enum.
 *
 * Run: npx tsx scripts/migrate-mapping-fields.ts
 * Then: npm run db:push
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function run() {
  console.log("Starting mapping fields migration...\n");

  // Step 1: Add new columns (idempotent — skip if already present)
  const columns = db.pragma("table_info(field_mapping)") as { name: string }[];
  const colNames = new Set(columns.map((c) => c.name));

  if (!colNames.has("mapping_type")) {
    console.log("Adding mapping_type column...");
    db.exec("ALTER TABLE field_mapping ADD COLUMN mapping_type TEXT");
  } else {
    console.log("mapping_type column already exists, skipping.");
  }

  if (!colNames.has("assignee_id")) {
    console.log("Adding assignee_id column...");
    db.exec("ALTER TABLE field_mapping ADD COLUMN assignee_id TEXT REFERENCES user(id) ON DELETE SET NULL");
  } else {
    console.log("assignee_id column already exists, skipping.");
  }

  // Step 2: Backfill mapping_type from old status values (before status migration)
  console.log("\nBackfilling mapping_type from old statuses...");

  const derivedCount = db.prepare(
    "UPDATE field_mapping SET mapping_type = 'derived' WHERE status = 'derived' AND mapping_type IS NULL"
  ).run();
  console.log(`  derived → mapping_type='derived': ${derivedCount.changes} rows`);

  const defaultCount = db.prepare(
    "UPDATE field_mapping SET mapping_type = 'direct' WHERE status IN ('default', 'system_generated') AND mapping_type IS NULL"
  ).run();
  console.log(`  default/system_generated → mapping_type='direct': ${defaultCount.changes} rows`);

  const mappedCount = db.prepare(
    "UPDATE field_mapping SET mapping_type = 'direct' WHERE status = 'mapped' AND mapping_type IS NULL"
  ).run();
  console.log(`  mapped → mapping_type='direct': ${mappedCount.changes} rows`);

  // Step 3: Migrate statuses to new enum values
  console.log("\nMigrating statuses...");

  const closedCount = db.prepare(
    "UPDATE field_mapping SET status = 'fully_closed' WHERE status IN ('mapped', 'not_available', 'derived', 'default', 'system_generated')"
  ).run();
  console.log(`  mapped/not_available/derived/default/system_generated → fully_closed: ${closedCount.changes} rows`);

  const clarificationCount = db.prepare(
    "UPDATE field_mapping SET status = 'open_comment_vt' WHERE status = 'requires_clarification'"
  ).run();
  console.log(`  requires_clarification → open_comment_vt: ${clarificationCount.changes} rows`);

  // 'unmapped' stays as-is
  const unmappedCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM field_mapping WHERE status = 'unmapped'"
  ).get() as { cnt: number };
  console.log(`  unmapped (unchanged): ${unmappedCount.cnt} rows`);

  // Step 4: Create index on assignee_id
  console.log("\nCreating index on assignee_id...");
  try {
    db.exec("CREATE INDEX IF NOT EXISTS mapping_assignee_idx ON field_mapping(assignee_id)");
    console.log("  Index created.");
  } catch (err) {
    console.log("  Index already exists or error:", (err as Error).message);
  }

  // Step 5: Verify
  console.log("\nVerification — status distribution after migration:");
  const statusDist = db.prepare(
    "SELECT status, COUNT(*) as cnt FROM field_mapping GROUP BY status ORDER BY cnt DESC"
  ).all() as { status: string; cnt: number }[];
  for (const row of statusDist) {
    console.log(`  ${row.status}: ${row.cnt}`);
  }

  console.log("\nmapping_type distribution:");
  const typeDist = db.prepare(
    "SELECT mapping_type, COUNT(*) as cnt FROM field_mapping GROUP BY mapping_type ORDER BY cnt DESC"
  ).all() as { mapping_type: string | null; cnt: number }[];
  for (const row of typeDist) {
    console.log(`  ${row.mapping_type ?? "(null)"}: ${row.cnt}`);
  }

  console.log("\nMigration complete! Now run: npm run db:push");
}

run();
