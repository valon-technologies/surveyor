/**
 * Migration: Convert flat question→answer model to threaded question replies.
 *
 * 1. Creates `question_reply` table + new question columns via db:push
 * 2. For each answered question with answer text:
 *    - Creates a questionReply record with isResolution=true
 *    - Updates question: resolvedBy, resolvedAt, replyCount=1, status='resolved'
 * 3. For answered questions without answer text: sets status='resolved'
 *
 * Run: npm run db:push && npx tsx scripts/migrate-questions-to-threads.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function run() {
  console.log("Starting question threads migration...\n");

  // Step 1: Check if question_reply table exists
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='question_reply'"
  ).get();

  if (!tableExists) {
    console.log("question_reply table not found. Run 'npm run db:push' first.");
    process.exit(1);
  }

  // Step 2: Check new columns exist on question table
  const columns = db.pragma("table_info(question)") as { name: string }[];
  const colNames = new Set(columns.map((c) => c.name));

  if (!colNames.has("resolved_by")) {
    console.log("New question columns not found. Run 'npm run db:push' first.");
    process.exit(1);
  }

  // Step 3: Migrate answered questions with answer text
  const answeredWithText = db.prepare(`
    SELECT q.id, q.answer, q.answered_by, q.updated_at, q.workspace_id, q.entity_id
    FROM question q
    WHERE q.status = 'answered' AND q.answer IS NOT NULL AND q.answer != ''
  `).all() as Array<{
    id: string;
    answer: string;
    answered_by: string | null;
    updated_at: string;
    workspace_id: string;
    entity_id: string | null;
  }>;

  console.log(`Found ${answeredWithText.length} answered questions with text to migrate.`);

  const insertReply = db.prepare(`
    INSERT INTO question_reply (id, question_id, author_id, author_name, author_role, body, is_resolution, created_at)
    VALUES (?, ?, ?, ?, 'user', ?, 1, ?)
  `);

  const updateQuestion = db.prepare(`
    UPDATE question
    SET status = 'resolved',
        resolved_by = ?,
        resolved_by_name = ?,
        resolved_at = ?,
        reply_count = 1
    WHERE id = ?
  `);

  const migrate = db.transaction(() => {
    for (const q of answeredWithText) {
      // Resolve author name from user table
      let authorName = "User";
      let authorId: string | null = null;

      if (q.answered_by) {
        const userRow = db.prepare(
          "SELECT id, name FROM user WHERE id = ?"
        ).get(q.answered_by) as { id: string; name: string | null } | undefined;

        if (userRow) {
          authorId = userRow.id;
          authorName = userRow.name || "User";
        }
      }

      const replyId = crypto.randomUUID();
      const resolvedAt = q.updated_at || new Date().toISOString();

      insertReply.run(replyId, q.id, authorId, authorName, q.answer, resolvedAt);
      updateQuestion.run(authorId, authorName, resolvedAt, q.id);
    }

    // Step 4: Migrate answered questions without answer text
    const result = db.prepare(`
      UPDATE question
      SET status = 'resolved',
          resolved_at = updated_at
      WHERE status = 'answered' AND (answer IS NULL OR answer = '')
    `).run();

    console.log(`Updated ${result.changes} answered questions without text to 'resolved'.`);
  });

  migrate();

  // Verify
  const counts = db.prepare(`
    SELECT status, COUNT(*) as count FROM question GROUP BY status
  `).all() as Array<{ status: string; count: number }>;

  console.log("\nQuestion status counts after migration:");
  for (const row of counts) {
    console.log(`  ${row.status}: ${row.count}`);
  }

  const replyCount = db.prepare("SELECT COUNT(*) as count FROM question_reply").get() as { count: number };
  console.log(`\nTotal question replies created: ${replyCount.count}`);

  console.log("\nMigration complete!");
}

run();
