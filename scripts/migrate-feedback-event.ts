/**
 * Creates the feedback_event table. Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx scripts/migrate-feedback-event.ts
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

if (!tableExists("feedback_event")) {
  console.log("Creating feedback_event table...");
  db.exec(`
    CREATE TABLE feedback_event (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
      field_mapping_id TEXT REFERENCES field_mapping(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      correlation_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX idx_feedback_event_entity ON feedback_event(entity_id, created_at DESC);
    CREATE INDEX idx_feedback_event_correlation ON feedback_event(correlation_id);
  `);
  console.log("  feedback_event table created.");
} else {
  console.log("feedback_event table already exists.");
}

console.log("\nDone!");
db.close();
