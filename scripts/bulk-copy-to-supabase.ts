/**
 * Bulk COPY migration: Load CSV exports from SQLite into Supabase Postgres.
 * Uses postgres-js writable stream for COPY FROM STDIN.
 *
 * Usage: DATABASE_URL_DIRECT="..." npx tsx scripts/bulk-copy-to-supabase.ts
 */

import { createReadStream } from "fs";
import { stat } from "fs/promises";
import postgres from "postgres";

const connStr = process.env.DATABASE_URL_DIRECT!;
const sql = postgres(connStr, { prepare: false });
const CSV_DIR = "/tmp/surveyor-csv";

const TABLES_IN_ORDER = [
  "mapping_context",
  "chat_session",
  "chat_message",
  "question",
  "question_reply",
  "learning",
  "entity_pipeline",
  "feedback_event",
  "activity",
  "sot_evaluation",
];

// Columns for each table (must match CSV header order from sqlite3 -header -csv)
const TABLE_COLUMNS: Record<string, string> = {
  mapping_context: "id, field_mapping_id, context_id, context_type, excerpt, relevance, created_at",
  chat_session: "id, workspace_id, field_mapping_id, target_field_id, entity_id, entity_name, skill_id, status, created_by, created_by_name, session_type, summary, created_at, updated_at",
  chat_message: "id, session_id, role, content, metadata, created_at",
  question: "id, workspace_id, entity_id, field_id, question, answer, status, asked_by, answered_by, priority, target_for_team, field_mapping_id, chat_session_id, feedback_helpful, feedback_why_not, feedback_better_question, schema_asset_ids, assignee_ids, resolved_by, resolved_by_name, resolved_at, reply_count, created_by_user_id, auto_resolved_from, curation_status, curation_note, created_at, updated_at",
  question_reply: "id, question_id, author_id, author_name, author_role, body, is_resolution, metadata, edited_at, created_at",
  learning: "id, workspace_id, entity_id, field_name, scope, source, content, validation_status, created_at",
  entity_pipeline: "id, workspace_id, entity_id, version, parent_id, is_latest, yaml_spec, table_name, primary_key, sources, joins, concat, structure_type, is_stale, sql_validation_status, sql_validation_error, sql_validation_at, generation_id, batch_run_id, edited_by, change_summary, created_at, updated_at",
  feedback_event: "id, workspace_id, entity_id, field_mapping_id, event_type, payload, correlation_id, created_at",
  activity: "id, workspace_id, field_mapping_id, entity_id, actor_id, actor_name, action, detail, created_at",
  sot_evaluation: "id, workspace_id, entity_id, generation_id, batch_run_id, total_fields, scored_fields, source_exact_count, source_lenient_count, source_exact_pct, source_lenient_pct, field_results, created_at",
};

async function main() {
  console.log("=== Bulk COPY Migration ===\n");

  for (const table of TABLES_IN_ORDER) {
    const csvPath = `${CSV_DIR}/${table}.csv`;

    // Check file exists and has data
    try {
      const s = await stat(csvPath);
      if (s.size < 10) {
        console.log(`${table}: empty CSV, skipping`);
        continue;
      }
    } catch {
      console.log(`${table}: no CSV found, skipping`);
      continue;
    }

    // Clear any partial data from previous migration attempt
    const [existing] = await sql`SELECT COUNT(*)::int as cnt FROM ${sql(table)}`;
    if (existing.cnt > 0) {
      console.log(`${table}: clearing ${existing.cnt} existing rows...`);
      await sql`DELETE FROM ${sql(table)}`;
    }

    const columns = TABLE_COLUMNS[table];
    if (!columns) {
      console.log(`${table}: no column mapping, skipping`);
      continue;
    }

    console.log(`${table}: loading via COPY...`);
    const start = Date.now();

    try {
      const stream = createReadStream(csvPath);
      await sql`COPY ${sql(table)} (${sql.unsafe(columns)}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')`.writable().then(async (writable) => {
        return new Promise<void>((resolve, reject) => {
          stream.pipe(writable);
          writable.on("finish", resolve);
          writable.on("error", reject);
          stream.on("error", reject);
        });
      });

      const [count] = await sql`SELECT COUNT(*)::int as cnt FROM ${sql(table)}`;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ${count.cnt} rows loaded in ${elapsed}s\n`);
    } catch (err) {
      console.error(`  COPY failed for ${table}:`, (err as Error).message?.slice(0, 200));
      console.log("  Skipping...\n");
    }
  }

  // Verification
  console.log("=== Verification ===");
  const counts = await sql`
    SELECT 'user' as tbl, COUNT(*)::int as cnt FROM "user"
    UNION ALL SELECT 'entity', COUNT(*)::int FROM entity
    UNION ALL SELECT 'field', COUNT(*)::int FROM field
    UNION ALL SELECT 'field_mapping', COUNT(*)::int FROM field_mapping
    UNION ALL SELECT 'context', COUNT(*)::int FROM context
    UNION ALL SELECT 'mapping_context', COUNT(*)::int FROM mapping_context
    UNION ALL SELECT 'generation', COUNT(*)::int FROM generation
    UNION ALL SELECT 'chat_session', COUNT(*)::int FROM chat_session
    UNION ALL SELECT 'chat_message', COUNT(*)::int FROM chat_message
    UNION ALL SELECT 'question', COUNT(*)::int FROM question
    UNION ALL SELECT 'learning', COUNT(*)::int FROM learning
    UNION ALL SELECT 'entity_pipeline', COUNT(*)::int FROM entity_pipeline
    UNION ALL SELECT 'feedback_event', COUNT(*)::int FROM feedback_event
    UNION ALL SELECT 'activity', COUNT(*)::int FROM activity
    ORDER BY tbl
  `;
  for (const r of counts) console.log(`  ${r.tbl}: ${r.cnt}`);

  console.log("\nDone!");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
