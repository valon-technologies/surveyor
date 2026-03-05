/**
 * Bulk insert remaining tables using multi-row VALUES with postgres-js.
 * Handles JSON columns properly (unlike CSV COPY).
 *
 * Usage: DATABASE_URL_DIRECT="..." npx tsx scripts/bulk-insert-remaining.ts
 */

import { execSync } from "child_process";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false });
const SQLITE = "./surveyor.db";
const BATCH = 50;

function queryJson(query: string): Record<string, unknown>[] {
  try {
    const raw = execSync(`sqlite3 -json "${SQLITE}" "${query}"`, {
      maxBuffer: 500 * 1024 * 1024,
    }).toString().trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

function n(v: unknown): string | null { return v == null ? null : String(v); }
function toBool(v: unknown): boolean { return v === 1 || v === true || v === "1"; }
function toJsonb(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") { try { JSON.parse(v); return v; } catch { return null; } }
  return JSON.stringify(v);
}
function numOrNull(v: unknown): number | null { return v == null ? null : Number(v); }

async function bulkInsert(table: string, rows: Record<string, unknown>[], insertFn: (row: Record<string, unknown>) => Promise<void>) {
  console.log(`${table}: ${rows.length} rows`);
  if (rows.length === 0) { console.log("  Skipped.\n"); return; }
  const start = Date.now();
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await sql.begin(async (tx) => {
      for (const r of batch) {
        try { await insertFn(r); } catch (e) { /* skip duplicates */ }
      }
    });
    done = Math.min(i + BATCH, rows.length);
    process.stdout.write(`  ${done}/${rows.length}\r`);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ${done} rows in ${elapsed}s\n`);
}

async function main() {
  console.log("=== Bulk Insert Remaining Tables ===\n");

  // chat_session
  await bulkInsert("chat_session", queryJson("SELECT * FROM chat_session"), async (s) => {
    await sql`INSERT INTO chat_session (id, workspace_id, field_mapping_id, target_field_id, entity_id, skill_id, status, created_by, created_by_name, session_type, summary, created_at, updated_at)
      VALUES (${n(s.id)}, ${n(s.workspace_id)}, ${n(s.field_mapping_id)}, ${n(s.target_field_id)}, ${n(s.entity_id)}, ${n(s.skill_id)}, ${n(s.status)}, ${n(s.created_by)}, ${n(s.created_by_name)}, ${n(s.session_type)}, ${n(s.summary)}, ${n(s.created_at)}, ${n(s.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  });

  // chat_message (largest remaining — 226k)
  await bulkInsert("chat_message", queryJson("SELECT * FROM chat_message"), async (m) => {
    await sql`INSERT INTO chat_message (id, session_id, role, content, metadata, created_at)
      VALUES (${n(m.id)}, ${n(m.session_id)}, ${n(m.role)}, ${n(m.content)}, ${toJsonb(m.metadata)}, ${n(m.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  });

  // question
  await bulkInsert("question", queryJson("SELECT * FROM question"), async (q) => {
    await sql`INSERT INTO question (id, workspace_id, entity_id, field_id, question, answer, status, asked_by, answered_by, priority, target_for_team, field_mapping_id, chat_session_id, feedback_helpful, feedback_why_not, feedback_better_question, schema_asset_ids, assignee_ids, resolved_by, resolved_by_name, resolved_at, reply_count, created_by_user_id, auto_resolved_from, curation_status, curation_note, created_at, updated_at)
      VALUES (${n(q.id)}, ${n(q.workspace_id)}, ${n(q.entity_id)}, ${n(q.field_id)}, ${n(q.question)}, ${n(q.answer)}, ${n(q.status)}, ${n(q.asked_by)}, ${n(q.answered_by)}, ${n(q.priority)}, ${n(q.target_for_team)}, ${n(q.field_mapping_id)}, ${n(q.chat_session_id)}, ${q.feedback_helpful != null ? toBool(q.feedback_helpful) : null}, ${n(q.feedback_why_not)}, ${n(q.feedback_better_question)}, ${toJsonb(q.schema_asset_ids)}, ${toJsonb(q.assignee_ids)}, ${n(q.resolved_by)}, ${n(q.resolved_by_name)}, ${n(q.resolved_at)}, ${Number(q.reply_count || 0)}, ${n(q.created_by_user_id)}, ${n(q.auto_resolved_from)}, ${n(q.curation_status)}, ${n(q.curation_note)}, ${n(q.created_at)}, ${n(q.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  });

  // learning
  await bulkInsert("learning", queryJson("SELECT * FROM learning"), async (l) => {
    await sql`INSERT INTO learning (id, workspace_id, entity_id, field_name, scope, source, content, validation_status, created_at)
      VALUES (${n(l.id)}, ${n(l.workspace_id)}, ${n(l.entity_id)}, ${n(l.field_name)}, ${n(l.scope)}, ${n(l.source)}, ${n(l.content)}, ${n(l.validation_status)}, ${n(l.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  });

  // entity_pipeline (27k — second largest)
  await bulkInsert("entity_pipeline", queryJson("SELECT * FROM entity_pipeline"), async (p) => {
    await sql`INSERT INTO entity_pipeline (id, workspace_id, entity_id, version, parent_id, is_latest, yaml_spec, table_name, primary_key, sources, joins, concat, structure_type, is_stale, sql_validation_status, sql_validation_error, sql_validation_at, generation_id, batch_run_id, edited_by, change_summary, created_at, updated_at)
      VALUES (${n(p.id)}, ${n(p.workspace_id)}, ${n(p.entity_id)}, ${Number(p.version || 1)}, ${n(p.parent_id)}, ${toBool(p.is_latest)}, ${n(p.yaml_spec)}, ${n(p.table_name)}, ${toJsonb(p.primary_key)}, ${toJsonb(p.sources)}, ${toJsonb(p.joins)}, ${toJsonb(p.concat)}, ${n(p.structure_type)}, ${toBool(p.is_stale)}, ${n(p.sql_validation_status)}, ${n(p.sql_validation_error)}, ${n(p.sql_validation_at)}, ${n(p.generation_id)}, ${n(p.batch_run_id)}, ${n(p.edited_by)}, ${n(p.change_summary)}, ${n(p.created_at)}, ${n(p.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  });

  // feedback_event
  await bulkInsert("feedback_event", queryJson("SELECT * FROM feedback_event"), async (e) => {
    await sql`INSERT INTO feedback_event (id, workspace_id, entity_id, field_mapping_id, event_type, payload, correlation_id, created_at)
      VALUES (${n(e.id)}, ${n(e.workspace_id)}, ${n(e.entity_id)}, ${n(e.field_mapping_id)}, ${n(e.event_type)}, ${toJsonb(e.payload)}, ${n(e.correlation_id)}, ${n(e.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  });

  // activity
  await bulkInsert("activity", queryJson("SELECT * FROM activity"), async (a) => {
    await sql`INSERT INTO activity (id, workspace_id, field_mapping_id, entity_id, actor_id, actor_name, action, detail, created_at)
      VALUES (${n(a.id)}, ${n(a.workspace_id)}, ${n(a.field_mapping_id)}, ${n(a.entity_id)}, ${n(a.actor_id)}, ${n(a.actor_name)}, ${n(a.action)}, ${toJsonb(a.detail)}, ${n(a.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  });

  // sot_evaluation
  await bulkInsert("sot_evaluation", queryJson("SELECT * FROM sot_evaluation"), async (s) => {
    await sql`INSERT INTO sot_evaluation (id, workspace_id, entity_id, generation_id, batch_run_id, total_fields, scored_fields, source_exact_count, source_lenient_count, source_exact_pct, source_lenient_pct, field_results, created_at)
      VALUES (${n(s.id)}, ${n(s.workspace_id)}, ${n(s.entity_id)}, ${n(s.generation_id)}, ${n(s.batch_run_id)}, ${Number(s.total_fields)}, ${Number(s.scored_fields)}, ${Number(s.source_exact_count)}, ${Number(s.source_lenient_count)}, ${Number(s.source_exact_pct)}, ${Number(s.source_lenient_pct)}, ${toJsonb(s.field_results)}, ${n(s.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  });

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
  console.error("Failed:", err);
  process.exit(1);
});
