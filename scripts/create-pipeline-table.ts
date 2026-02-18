/**
 * Creates the entity_pipeline table. Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx scripts/create-pipeline-table.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

if (!tableExists("entity_pipeline")) {
  console.log("Creating entity_pipeline table...");
  db.exec(`
    CREATE TABLE entity_pipeline (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      parent_id TEXT,
      is_latest INTEGER NOT NULL DEFAULT 1,
      yaml_spec TEXT NOT NULL,
      table_name TEXT NOT NULL,
      primary_key TEXT,
      sources TEXT NOT NULL,
      joins TEXT,
      concat TEXT,
      structure_type TEXT NOT NULL DEFAULT 'flat',
      is_stale INTEGER NOT NULL DEFAULT 0,
      generation_id TEXT,
      batch_run_id TEXT,
      edited_by TEXT,
      change_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX entity_pipeline_workspace_idx ON entity_pipeline(workspace_id);
    CREATE INDEX entity_pipeline_entity_idx ON entity_pipeline(entity_id);
    CREATE INDEX entity_pipeline_latest_idx ON entity_pipeline(entity_id, is_latest);
  `);
  console.log("  entity_pipeline table created.");
} else {
  console.log("entity_pipeline table already exists.");
}

console.log("\nDone!");
db.close();
