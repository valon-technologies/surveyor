/**
 * Migration: Add validation gates to learning and question tables.
 *
 * - learning: validationStatus, validatedBy, validatedAt
 * - question: curationStatus, curatedBy, curatedAt, duplicateOf
 *
 * Existing data is grandfathered:
 * - Existing learnings → validationStatus: "validated" (already in use)
 * - Existing open questions → curationStatus: "approved" (already visible)
 * - Other questions → curationStatus: "draft"
 */
import Database from "better-sqlite3";

const db = new Database(process.env.DATABASE_PATH || "./surveyor.db");
db.pragma("journal_mode = WAL");

// Learning table
const learningCols = db.prepare("PRAGMA table_info(learning)").all() as { name: string }[];
if (!learningCols.some(c => c.name === "validation_status")) {
  console.log("Adding validation columns to learning...");
  db.exec("ALTER TABLE learning ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'pending'");
  db.exec("ALTER TABLE learning ADD COLUMN validated_by TEXT");
  db.exec("ALTER TABLE learning ADD COLUMN validated_at TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS learning_validation_idx ON learning(validation_status)");

  // Grandfather existing learnings as validated
  const result = db.prepare("UPDATE learning SET validation_status = 'validated'").run();
  console.log(`  Grandfathered ${result.changes} existing learnings as validated`);
} else {
  console.log("Learning validation columns already exist");
}

// Question table
const questionCols = db.prepare("PRAGMA table_info(question)").all() as { name: string }[];
if (!questionCols.some(c => c.name === "curation_status")) {
  console.log("Adding curation columns to question...");
  db.exec("ALTER TABLE question ADD COLUMN curation_status TEXT NOT NULL DEFAULT 'draft'");
  db.exec("ALTER TABLE question ADD COLUMN curated_by TEXT");
  db.exec("ALTER TABLE question ADD COLUMN curated_at TEXT");
  db.exec("ALTER TABLE question ADD COLUMN duplicate_of TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS question_curation_idx ON question(curation_status)");

  // Grandfather existing open questions as approved
  const result = db.prepare("UPDATE question SET curation_status = 'approved' WHERE status = 'open'").run();
  console.log(`  Grandfathered ${result.changes} open questions as approved`);
  const resolved = db.prepare("UPDATE question SET curation_status = 'approved' WHERE status = 'resolved'").run();
  console.log(`  Grandfathered ${resolved.changes} resolved questions as approved`);
} else {
  console.log("Question curation columns already exist");
}

console.log("Done.");
