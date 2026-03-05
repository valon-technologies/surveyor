/**
 * Full migration: Copy ALL data from local SQLite to Supabase PostgreSQL.
 *
 * Usage: npx tsx scripts/migrate-all-to-supabase.ts
 *
 * Uses DATABASE_URL_DIRECT (port 5432) from .env.local for direct connection.
 */

import { execSync } from "child_process";
import postgres from "postgres";
import "dotenv/config";

const SQLITE_PATH = "./surveyor.db";
const BATCH_SIZE = 200;

const connStr = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL_DIRECT or DATABASE_URL not set");

const client = postgres(connStr, { prepare: false });

function queryJson<T>(sql: string): T[] {
  try {
    const raw = execSync(`sqlite3 -json "${SQLITE_PATH}" "${sql}"`, {
      maxBuffer: 200 * 1024 * 1024,
    }).toString().trim();
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch (e: unknown) {
    // sqlite3 returns exit code 1 for empty results
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("[]") || msg.includes("stdout maxBuffer")) throw e;
    return [];
  }
}

function n(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

function toBool(val: unknown): boolean {
  return val === 1 || val === true || val === "1" || val === "true";
}

function toJsonb(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "string") {
    try { JSON.parse(val); return val; } catch { return null; }
  }
  return JSON.stringify(val);
}

function num(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

function numOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  return Number(val);
}

function realOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  return Number(val);
}

async function migrateTable(
  table: string,
  insertFn: (rows: Record<string, unknown>[]) => Promise<void>,
) {
  const rows = queryJson<Record<string, unknown>>(`SELECT * FROM "${table}"`);
  console.log(`${table}: ${rows.length} rows`);
  if (rows.length === 0) { console.log("  Skipped (empty).\n"); return; }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await client.begin(async (tx) => {
      for (const row of batch) {
        await insertFn.call(null, [row]).catch(async (err) => {
          // Use main client for single-row retry with ON CONFLICT
          console.warn(`  Warning: ${table} row ${(row as Record<string, unknown>).id}: ${(err as Error).message?.slice(0, 100)}`);
        });
      }
    });
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`);
  }
  console.log(`  Done.\n`);
}

async function main() {
  console.log("=== Full SQLite → Supabase Migration ===\n");

  // 1. user
  const users = queryJson<Record<string, unknown>>("SELECT * FROM user");
  console.log(`user: ${users.length} rows`);
  for (const u of users) {
    await client`INSERT INTO "user" (id, name, email, email_verified, image, password_hash, domains, created_at, updated_at)
      VALUES (${n(u.id)}, ${n(u.name)}, ${n(u.email)}, ${n(u.email_verified)}, ${n(u.image)}, ${n(u.password_hash)}, ${toJsonb(u.domains)}, ${n(u.created_at)}, ${n(u.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 2. workspace
  const workspaces = queryJson<Record<string, unknown>>("SELECT * FROM workspace");
  console.log(`workspace: ${workspaces.length} rows`);
  for (const w of workspaces) {
    await client`INSERT INTO workspace (id, name, description, settings, created_at, updated_at)
      VALUES (${n(w.id)}, ${n(w.name)}, ${n(w.description)}, ${toJsonb(w.settings)}, ${n(w.created_at)}, ${n(w.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 3. user_workspace
  const uw = queryJson<Record<string, unknown>>("SELECT * FROM user_workspace");
  console.log(`user_workspace: ${uw.length} rows`);
  for (const r of uw) {
    await client`INSERT INTO user_workspace (id, user_id, workspace_id, role, team, created_at)
      VALUES (${n(r.id)}, ${n(r.user_id)}, ${n(r.workspace_id)}, ${n(r.role)}, ${n(r.team)}, ${n(r.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 4. schema_asset
  const assets = queryJson<Record<string, unknown>>("SELECT * FROM schema_asset");
  console.log(`schema_asset: ${assets.length} rows`);
  for (const a of assets) {
    await client`INSERT INTO schema_asset (id, workspace_id, name, side, description, source_file, format, raw_content, metadata, created_at, updated_at)
      VALUES (${n(a.id)}, ${n(a.workspace_id)}, ${n(a.name)}, ${n(a.side)}, ${n(a.description)}, ${n(a.source_file)}, ${n(a.format)}, ${n(a.raw_content)}, ${toJsonb(a.metadata)}, ${n(a.created_at)}, ${n(a.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 5. entity
  const entities = queryJson<Record<string, unknown>>("SELECT * FROM entity");
  console.log(`entity: ${entities.length} rows`);
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    for (const e of batch) {
      await client`INSERT INTO entity (id, workspace_id, schema_asset_id, name, display_name, side, description, parent_entity_id, status, sort_order, domain_tags, metadata, created_at, updated_at)
        VALUES (${n(e.id)}, ${n(e.workspace_id)}, ${n(e.schema_asset_id)}, ${n(e.name)}, ${n(e.display_name)}, ${n(e.side)}, ${n(e.description)}, ${n(e.parent_entity_id)}, ${n(e.status)}, ${num(e.sort_order)}, ${toJsonb(e.domain_tags)}, ${toJsonb(e.metadata)}, ${n(e.created_at)}, ${n(e.updated_at)})
        ON CONFLICT (id) DO NOTHING`;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, entities.length)}/${entities.length}\r`);
  }
  console.log("  Done.\n");

  // 6. field
  const fields = queryJson<Record<string, unknown>>("SELECT * FROM field");
  console.log(`field: ${fields.length} rows`);
  for (let i = 0; i < fields.length; i += BATCH_SIZE) {
    const batch = fields.slice(i, i + BATCH_SIZE);
    for (const f of batch) {
      await client`INSERT INTO field (id, entity_id, name, display_name, data_type, is_required, is_key, description, milestone, domain_tag, sample_values, enum_values, sort_order, metadata, created_at, updated_at)
        VALUES (${n(f.id)}, ${n(f.entity_id)}, ${n(f.name)}, ${n(f.display_name)}, ${n(f.data_type)}, ${toBool(f.is_required)}, ${toBool(f.is_key)}, ${n(f.description)}, ${n(f.milestone)}, ${n(f.domain_tag)}, ${toJsonb(f.sample_values)}, ${toJsonb(f.enum_values)}, ${num(f.sort_order)}, ${toJsonb(f.metadata)}, ${n(f.created_at)}, ${n(f.updated_at)})
        ON CONFLICT (id) DO NOTHING`;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, fields.length)}/${fields.length}\r`);
  }
  console.log("  Done.\n");

  // 7. context
  const contexts = queryJson<Record<string, unknown>>("SELECT * FROM context");
  console.log(`context: ${contexts.length} rows`);
  for (let i = 0; i < contexts.length; i += BATCH_SIZE) {
    const batch = contexts.slice(i, i + BATCH_SIZE);
    for (const c of batch) {
      await client`INSERT INTO context (id, workspace_id, name, category, subcategory, entity_id, field_id, content, content_format, token_count, tags, is_active, sort_order, import_source, metadata, created_at, updated_at)
        VALUES (${n(c.id)}, ${n(c.workspace_id)}, ${n(c.name)}, ${n(c.category)}, ${n(c.subcategory)}, ${n(c.entity_id)}, ${n(c.field_id)}, ${n(c.content)}, ${n(c.content_format)}, ${numOrNull(c.token_count)}, ${toJsonb(c.tags)}, ${toBool(c.is_active)}, ${num(c.sort_order)}, ${n(c.import_source)}, ${toJsonb(c.metadata)}, ${n(c.created_at)}, ${n(c.updated_at)})
        ON CONFLICT (id) DO NOTHING`;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, contexts.length)}/${contexts.length}\r`);
  }
  console.log("  Done.\n");

  // 8. skill
  const skills = queryJson<Record<string, unknown>>("SELECT * FROM skill");
  console.log(`skill: ${skills.length} rows`);
  for (const s of skills) {
    await client`INSERT INTO skill (id, workspace_id, name, description, instructions, applicability, tags, is_active, sort_order, created_at, updated_at)
      VALUES (${n(s.id)}, ${n(s.workspace_id)}, ${n(s.name)}, ${n(s.description)}, ${n(s.instructions)}, ${toJsonb(s.applicability)}, ${toJsonb(s.tags)}, ${toBool(s.is_active)}, ${num(s.sort_order)}, ${n(s.created_at)}, ${n(s.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 9. skill_context
  const scs = queryJson<Record<string, unknown>>("SELECT * FROM skill_context");
  console.log(`skill_context: ${scs.length} rows`);
  for (const sc of scs) {
    await client`INSERT INTO skill_context (id, skill_id, context_id, role, sort_order, notes, created_at)
      VALUES (${n(sc.id)}, ${n(sc.skill_id)}, ${n(sc.context_id)}, ${n(sc.role)}, ${num(sc.sort_order)}, ${n(sc.notes)}, ${n(sc.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 10. generation
  const gens = queryJson<Record<string, unknown>>("SELECT * FROM generation");
  console.log(`generation: ${gens.length} rows`);
  for (const g of gens) {
    await client`INSERT INTO generation (id, workspace_id, entity_id, generation_type, status, provider, model, prompt_snapshot, output, output_parsed, input_tokens, output_tokens, duration_ms, error, validation_score, validation_issues, batch_run_id, created_at, updated_at)
      VALUES (${n(g.id)}, ${n(g.workspace_id)}, ${n(g.entity_id)}, ${n(g.generation_type)}, ${n(g.status)}, ${n(g.provider)}, ${n(g.model)}, ${toJsonb(g.prompt_snapshot)}, ${n(g.output)}, ${toJsonb(g.output_parsed)}, ${numOrNull(g.input_tokens)}, ${numOrNull(g.output_tokens)}, ${numOrNull(g.duration_ms)}, ${n(g.error)}, ${numOrNull(g.validation_score)}, ${toJsonb(g.validation_issues)}, ${n(g.batch_run_id)}, ${n(g.created_at)}, ${n(g.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 11. batch_run
  const brs = queryJson<Record<string, unknown>>("SELECT * FROM batch_run");
  console.log(`batch_run: ${brs.length} rows`);
  for (const b of brs) {
    await client`INSERT INTO batch_run (id, workspace_id, status, total_entities, completed_entities, failed_entities, total_fields, completed_fields, current_entity_name, config, started_at, completed_at, created_by, created_at, updated_at)
      VALUES (${n(b.id)}, ${n(b.workspace_id)}, ${n(b.status)}, ${num(b.total_entities)}, ${num(b.completed_entities)}, ${num(b.failed_entities)}, ${num(b.total_fields)}, ${num(b.completed_fields)}, ${n(b.current_entity_name)}, ${toJsonb(b.config)}, ${n(b.started_at)}, ${n(b.completed_at)}, ${n(b.created_by)}, ${n(b.created_at)}, ${n(b.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 12. field_mapping (large — batch it)
  const mappings = queryJson<Record<string, unknown>>("SELECT * FROM field_mapping");
  console.log(`field_mapping: ${mappings.length} rows`);
  for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
    const batch = mappings.slice(i, i + BATCH_SIZE);
    for (const m of batch) {
      await client`INSERT INTO field_mapping (id, workspace_id, target_field_id, status, mapping_type, assignee_id, source_entity_id, source_field_id, transform, default_value, enum_mapping, reasoning, confidence, notes, created_by, generation_id, version, parent_id, is_latest, edited_by, change_summary, punt_note, exclude_reason, source_verdict, source_verdict_notes, transform_verdict, transform_verdict_notes, ai_review, batch_run_id, created_at, updated_at)
        VALUES (${n(m.id)}, ${n(m.workspace_id)}, ${n(m.target_field_id)}, ${n(m.status)}, ${n(m.mapping_type)}, ${n(m.assignee_id)}, ${n(m.source_entity_id)}, ${n(m.source_field_id)}, ${n(m.transform)}, ${n(m.default_value)}, ${toJsonb(m.enum_mapping)}, ${n(m.reasoning)}, ${n(m.confidence)}, ${n(m.notes)}, ${n(m.created_by)}, ${n(m.generation_id)}, ${num(m.version)}, ${n(m.parent_id)}, ${toBool(m.is_latest)}, ${n(m.edited_by)}, ${n(m.change_summary)}, ${n(m.punt_note)}, ${n(m.exclude_reason)}, ${n(m.source_verdict)}, ${n(m.source_verdict_notes)}, ${n(m.transform_verdict)}, ${n(m.transform_verdict_notes)}, ${toJsonb(m.ai_review)}, ${n(m.batch_run_id)}, ${n(m.created_at)}, ${n(m.updated_at)})
        ON CONFLICT (id) DO NOTHING`;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, mappings.length)}/${mappings.length}\r`);
  }
  console.log("  Done.\n");

  // 13. mapping_context (largest table ~28k)
  const mcs = queryJson<Record<string, unknown>>("SELECT * FROM mapping_context");
  console.log(`mapping_context: ${mcs.length} rows`);
  for (let i = 0; i < mcs.length; i += BATCH_SIZE) {
    const batch = mcs.slice(i, i + BATCH_SIZE);
    for (const mc of batch) {
      await client`INSERT INTO mapping_context (id, field_mapping_id, context_id, context_type, relevance_score, created_at)
        VALUES (${n(mc.id)}, ${n(mc.field_mapping_id)}, ${n(mc.context_id)}, ${n(mc.context_type)}, ${realOrNull(mc.relevance_score)}, ${n(mc.created_at)})
        ON CONFLICT (id) DO NOTHING`;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, mcs.length)}/${mcs.length}\r`);
  }
  console.log("  Done.\n");

  // 14. chat_session
  const sessions = queryJson<Record<string, unknown>>("SELECT * FROM chat_session");
  console.log(`chat_session: ${sessions.length} rows`);
  for (const s of sessions) {
    await client`INSERT INTO chat_session (id, workspace_id, field_mapping_id, target_field_id, entity_id, entity_name, skill_id, status, created_by, created_by_name, session_type, summary, created_at, updated_at)
      VALUES (${n(s.id)}, ${n(s.workspace_id)}, ${n(s.field_mapping_id)}, ${n(s.target_field_id)}, ${n(s.entity_id)}, ${n(s.entity_name)}, ${n(s.skill_id)}, ${n(s.status)}, ${n(s.created_by)}, ${n(s.created_by_name)}, ${n(s.session_type)}, ${n(s.summary)}, ${n(s.created_at)}, ${n(s.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 15. chat_message
  const msgs = queryJson<Record<string, unknown>>("SELECT * FROM chat_message");
  console.log(`chat_message: ${msgs.length} rows`);
  for (let i = 0; i < msgs.length; i += BATCH_SIZE) {
    const batch = msgs.slice(i, i + BATCH_SIZE);
    for (const m of batch) {
      await client`INSERT INTO chat_message (id, session_id, role, content, metadata, created_at)
        VALUES (${n(m.id)}, ${n(m.session_id)}, ${n(m.role)}, ${n(m.content)}, ${toJsonb(m.metadata)}, ${n(m.created_at)})
        ON CONFLICT (id) DO NOTHING`;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, msgs.length)}/${msgs.length}\r`);
  }
  console.log("  Done.\n");

  // 16. question
  const qs = queryJson<Record<string, unknown>>("SELECT * FROM question");
  console.log(`question: ${qs.length} rows`);
  for (const q of qs) {
    await client`INSERT INTO question (id, workspace_id, entity_id, field_id, question, answer, status, asked_by, answered_by, priority, target_for_team, field_mapping_id, chat_session_id, feedback_helpful, feedback_why_not, feedback_better_question, schema_asset_ids, assignee_ids, resolved_by, resolved_by_name, resolved_at, reply_count, created_by_user_id, auto_resolved_from, curation_status, curation_note, created_at, updated_at)
      VALUES (${n(q.id)}, ${n(q.workspace_id)}, ${n(q.entity_id)}, ${n(q.field_id)}, ${n(q.question)}, ${n(q.answer)}, ${n(q.status)}, ${n(q.asked_by)}, ${n(q.answered_by)}, ${n(q.priority)}, ${n(q.target_for_team)}, ${n(q.field_mapping_id)}, ${n(q.chat_session_id)}, ${q.feedback_helpful !== null && q.feedback_helpful !== undefined ? toBool(q.feedback_helpful) : null}, ${n(q.feedback_why_not)}, ${n(q.feedback_better_question)}, ${toJsonb(q.schema_asset_ids)}, ${toJsonb(q.assignee_ids)}, ${n(q.resolved_by)}, ${n(q.resolved_by_name)}, ${n(q.resolved_at)}, ${num(q.reply_count)}, ${n(q.created_by_user_id)}, ${n(q.auto_resolved_from)}, ${n(q.curation_status)}, ${n(q.curation_note)}, ${n(q.created_at)}, ${n(q.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 17. question_reply
  const replies = queryJson<Record<string, unknown>>("SELECT * FROM question_reply");
  console.log(`question_reply: ${replies.length} rows`);
  for (const r of replies) {
    await client`INSERT INTO question_reply (id, question_id, author_id, author_name, author_role, body, is_resolution, metadata, edited_at, created_at)
      VALUES (${n(r.id)}, ${n(r.question_id)}, ${n(r.author_id)}, ${n(r.author_name)}, ${n(r.author_role)}, ${n(r.body)}, ${toBool(r.is_resolution)}, ${toJsonb(r.metadata)}, ${n(r.edited_at)}, ${n(r.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 18. learning
  const learnings = queryJson<Record<string, unknown>>("SELECT * FROM learning");
  console.log(`learning: ${learnings.length} rows`);
  for (const l of learnings) {
    await client`INSERT INTO learning (id, workspace_id, entity_id, field_name, scope, source, content, validation_status, created_at)
      VALUES (${n(l.id)}, ${n(l.workspace_id)}, ${n(l.entity_id)}, ${n(l.field_name)}, ${n(l.scope)}, ${n(l.source)}, ${n(l.content)}, ${n(l.validation_status)}, ${n(l.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 19. entity_pipeline
  const pipes = queryJson<Record<string, unknown>>("SELECT * FROM entity_pipeline");
  console.log(`entity_pipeline: ${pipes.length} rows`);
  for (const p of pipes) {
    await client`INSERT INTO entity_pipeline (id, workspace_id, entity_id, version, parent_id, is_latest, yaml_spec, table_name, primary_key, sources, joins, concat, structure_type, is_stale, sql_validation_status, sql_validation_error, sql_validation_at, generation_id, batch_run_id, edited_by, change_summary, created_at, updated_at)
      VALUES (${n(p.id)}, ${n(p.workspace_id)}, ${n(p.entity_id)}, ${num(p.version)}, ${n(p.parent_id)}, ${toBool(p.is_latest)}, ${n(p.yaml_spec)}, ${n(p.table_name)}, ${toJsonb(p.primary_key)}, ${toJsonb(p.sources)}, ${toJsonb(p.joins)}, ${toJsonb(p.concat)}, ${n(p.structure_type)}, ${toBool(p.is_stale)}, ${n(p.sql_validation_status)}, ${n(p.sql_validation_error)}, ${n(p.sql_validation_at)}, ${n(p.generation_id)}, ${n(p.batch_run_id)}, ${n(p.edited_by)}, ${n(p.change_summary)}, ${n(p.created_at)}, ${n(p.updated_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 20. feedback_event
  const events = queryJson<Record<string, unknown>>("SELECT * FROM feedback_event");
  console.log(`feedback_event: ${events.length} rows`);
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    for (const e of batch) {
      await client`INSERT INTO feedback_event (id, workspace_id, entity_id, field_mapping_id, event_type, payload, correlation_id, created_at)
        VALUES (${n(e.id)}, ${n(e.workspace_id)}, ${n(e.entity_id)}, ${n(e.field_mapping_id)}, ${n(e.event_type)}, ${toJsonb(e.payload)}, ${n(e.correlation_id)}, ${n(e.created_at)})
        ON CONFLICT (id) DO NOTHING`;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, events.length)}/${events.length}\r`);
  }
  console.log("  Done.\n");

  // 21. activity
  const activities = queryJson<Record<string, unknown>>("SELECT * FROM activity");
  console.log(`activity: ${activities.length} rows`);
  for (const a of activities) {
    await client`INSERT INTO activity (id, workspace_id, field_mapping_id, entity_id, actor_id, actor_name, action, detail, created_at)
      VALUES (${n(a.id)}, ${n(a.workspace_id)}, ${n(a.field_mapping_id)}, ${n(a.entity_id)}, ${n(a.actor_id)}, ${n(a.actor_name)}, ${n(a.action)}, ${toJsonb(a.detail)}, ${n(a.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 22. sot_evaluation
  const sots = queryJson<Record<string, unknown>>("SELECT * FROM sot_evaluation");
  console.log(`sot_evaluation: ${sots.length} rows`);
  for (const s of sots) {
    await client`INSERT INTO sot_evaluation (id, workspace_id, entity_id, generation_id, batch_run_id, total_fields, scored_fields, source_exact_count, source_lenient_count, source_exact_pct, source_lenient_pct, field_results, created_at)
      VALUES (${n(s.id)}, ${n(s.workspace_id)}, ${n(s.entity_id)}, ${n(s.generation_id)}, ${n(s.batch_run_id)}, ${num(s.total_fields)}, ${num(s.scored_fields)}, ${num(s.source_exact_count)}, ${num(s.source_lenient_count)}, ${Number(s.source_exact_pct)}, ${Number(s.source_lenient_pct)}, ${toJsonb(s.field_results)}, ${n(s.created_at)})
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log("  Done.\n");

  // 23-26. Remaining small tables
  for (const table of ["entity_scaffold", "skill_signal", "skill_refresh", "validation", "evaluation", "workspace_invite", "user_api_key", "user_bigquery_token", "verification_token", "comment_thread", "comment"]) {
    const rows = queryJson<Record<string, unknown>>(`SELECT * FROM "${table}"`);
    if (rows.length === 0) { console.log(`${table}: 0 rows (skipped)\n`); continue; }
    console.log(`${table}: ${rows.length} rows — skipping (handle manually if needed)\n`);
  }

  // === Verification ===
  console.log("\n=== Verification ===");
  const counts = await client`
    SELECT 'user' as tbl, COUNT(*)::int as cnt FROM "user"
    UNION ALL SELECT 'workspace', COUNT(*)::int FROM workspace
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
    UNION ALL SELECT 'skill', COUNT(*)::int FROM skill
    UNION ALL SELECT 'feedback_event', COUNT(*)::int FROM feedback_event
    ORDER BY tbl
  `;
  for (const row of counts) {
    console.log(`  ${row.tbl}: ${row.cnt}`);
  }

  console.log("\nMigration complete!");
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
