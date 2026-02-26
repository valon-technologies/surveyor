/**
 * Creates the sot_evaluation table. Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx scripts/migrate-sot-evaluation.ts
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

if (!tableExists("sot_evaluation")) {
  console.log("Creating sot_evaluation table...");
  db.exec(`
    CREATE TABLE sot_evaluation (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
      generation_id TEXT,
      batch_run_id TEXT,
      total_fields INTEGER NOT NULL,
      scored_fields INTEGER NOT NULL,
      source_exact_count INTEGER NOT NULL,
      source_lenient_count INTEGER NOT NULL,
      source_exact_pct REAL NOT NULL,
      source_lenient_pct REAL NOT NULL,
      field_results TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX sot_eval_workspace_idx ON sot_evaluation(workspace_id);
    CREATE INDEX sot_eval_entity_idx ON sot_evaluation(entity_id);
  `);
  console.log("  sot_evaluation table created.");
} else {
  console.log("sot_evaluation table already exists.");
}

console.log("\nDone!");
db.close();
