/**
 * migrate-fts5.ts — Create FTS5 virtual table for context full-text search
 *
 * Run: npx tsx scripts/migrate-fts5.ts
 *
 * Creates:
 * - context_fts virtual table (FTS5)
 * - Triggers to keep FTS in sync with the context table
 * - Populates FTS from existing data
 */

import Database from "better-sqlite3";
import { join } from "path";

const dbPath = process.env.DATABASE_PATH || join(process.cwd(), "surveyor.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

console.log("Creating FTS5 virtual table for context search...");

// Drop existing FTS table and triggers if they exist (idempotent)
sqlite.exec(`DROP TRIGGER IF EXISTS context_fts_insert;`);
sqlite.exec(`DROP TRIGGER IF EXISTS context_fts_update;`);
sqlite.exec(`DROP TRIGGER IF EXISTS context_fts_delete;`);
sqlite.exec(`DROP TABLE IF EXISTS context_fts;`);

// Create FTS5 virtual table
// context_id and workspace_id are UNINDEXED — stored for retrieval but not searched
sqlite.exec(`
  CREATE VIRTUAL TABLE context_fts USING fts5(
    context_id UNINDEXED,
    workspace_id UNINDEXED,
    name,
    content,
    tags
  );
`);

console.log("FTS5 table created.");

// Populate from existing data
const insertCount = sqlite.exec(`
  INSERT INTO context_fts (context_id, workspace_id, name, content, tags)
  SELECT
    id,
    workspace_id,
    name,
    COALESCE(content, ''),
    COALESCE(
      (SELECT GROUP_CONCAT(value, ' ')
       FROM json_each(tags)
       WHERE json_valid(tags)),
      ''
    )
  FROM context
  WHERE is_active = 1;
`);

const rowCount = sqlite
  .prepare("SELECT COUNT(*) as cnt FROM context_fts")
  .get() as { cnt: number };
console.log(`Populated FTS5 with ${rowCount.cnt} context documents.`);

// Create triggers to keep FTS in sync
sqlite.exec(`
  CREATE TRIGGER context_fts_insert AFTER INSERT ON context
  WHEN NEW.is_active = 1
  BEGIN
    INSERT INTO context_fts (context_id, workspace_id, name, content, tags)
    VALUES (
      NEW.id,
      NEW.workspace_id,
      NEW.name,
      COALESCE(NEW.content, ''),
      COALESCE(
        (SELECT GROUP_CONCAT(value, ' ')
         FROM json_each(NEW.tags)
         WHERE json_valid(NEW.tags)),
        ''
      )
    );
  END;
`);

sqlite.exec(`
  CREATE TRIGGER context_fts_update AFTER UPDATE ON context
  BEGIN
    DELETE FROM context_fts WHERE context_id = OLD.id;
    INSERT INTO context_fts (context_id, workspace_id, name, content, tags)
    SELECT
      NEW.id,
      NEW.workspace_id,
      NEW.name,
      COALESCE(NEW.content, ''),
      COALESCE(
        (SELECT GROUP_CONCAT(value, ' ')
         FROM json_each(NEW.tags)
         WHERE json_valid(NEW.tags)),
        ''
      )
    WHERE NEW.is_active = 1;
  END;
`);

sqlite.exec(`
  CREATE TRIGGER context_fts_delete AFTER DELETE ON context
  BEGIN
    DELETE FROM context_fts WHERE context_id = OLD.id;
  END;
`);

console.log("FTS5 sync triggers created.");
console.log("Done! FTS5 migration complete.");

sqlite.close();
