/**
 * One-time migration: Copy schema data from local SQLite to Supabase PostgreSQL.
 * Migrates: schema_asset, entity, field, field_mapping
 *
 * Usage: DATABASE_URL="..." npx tsx scripts/migrate-sqlite-to-supabase.ts
 */

import { execSync } from "child_process";
import postgres from "postgres";
import "dotenv/config";

const SQLITE_PATH = "./surveyor.db";
const OLD_WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";
const NEW_WORKSPACE_ID = "847602b2-188d-4fca-b1b1-d6098bb22aba";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });

function queryJson<T>(sql: string): T[] {
  const raw = execSync(`sqlite3 -json "${SQLITE_PATH}" "${sql}"`, {
    maxBuffer: 100 * 1024 * 1024,
  }).toString();
  return JSON.parse(raw) as T[];
}

function rw(val: unknown): string {
  return (val as string) === OLD_WORKSPACE_ID ? NEW_WORKSPACE_ID : (val as string);
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
    try {
      JSON.parse(val);
      return val;
    } catch {
      return null;
    }
  }
  return JSON.stringify(val);
}

function num(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

async function main() {
  console.log("Migrating data from SQLite to Supabase...\n");

  // --- schema_asset ---
  const assets = queryJson<Record<string, unknown>>("SELECT * FROM schema_asset");
  console.log(`schema_asset: ${assets.length} rows`);
  for (const a of assets) {
    await client`
      INSERT INTO schema_asset (id, workspace_id, name, side, description, source_file, format, raw_content, metadata, created_at, updated_at)
      VALUES (
        ${n(a.id)}, ${rw(a.workspace_id)}, ${n(a.name)}, ${n(a.side)},
        ${n(a.description)}, ${n(a.source_file)}, ${n(a.format)},
        ${n(a.raw_content)}, ${toJsonb(a.metadata)},
        ${n(a.created_at)}, ${n(a.updated_at)}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log("  Done.\n");

  // --- entity ---
  const entities = queryJson<Record<string, unknown>>("SELECT * FROM entity");
  console.log(`entity: ${entities.length} rows`);
  await client.begin(async (tx) => {
    for (const e of entities) {
      await tx`
        INSERT INTO entity (id, workspace_id, schema_asset_id, name, display_name, side, description, status, sort_order, metadata, created_at, updated_at)
        VALUES (
          ${n(e.id)}, ${rw(e.workspace_id)}, ${n(e.schema_asset_id)},
          ${n(e.name)}, ${n(e.display_name)}, ${n(e.side)},
          ${n(e.description)}, ${n(e.status)}, ${num(e.sort_order)},
          ${toJsonb(e.metadata)},
          ${n(e.created_at)}, ${n(e.updated_at)}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
  });
  console.log("  Done.\n");

  // --- field ---
  const fields = queryJson<Record<string, unknown>>("SELECT * FROM field");
  console.log(`field: ${fields.length} rows`);
  const BATCH_SIZE = 100;
  for (let i = 0; i < fields.length; i += BATCH_SIZE) {
    const batch = fields.slice(i, i + BATCH_SIZE);
    await client.begin(async (tx) => {
      for (const f of batch) {
        await tx`
          INSERT INTO field (id, entity_id, name, display_name, data_type, is_required, is_key, description, milestone, sample_values, enum_values, sort_order, metadata, created_at, updated_at)
          VALUES (
            ${n(f.id)}, ${n(f.entity_id)}, ${n(f.name)}, ${n(f.display_name)},
            ${n(f.data_type)},
            ${toBool(f.is_required)}, ${toBool(f.is_key)},
            ${n(f.description)}, ${n(f.milestone)},
            ${toJsonb(f.sample_values)}, ${toJsonb(f.enum_values)},
            ${num(f.sort_order)}, ${toJsonb(f.metadata)},
            ${n(f.created_at)}, ${n(f.updated_at)}
          )
          ON CONFLICT (id) DO NOTHING
        `;
      }
    });
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, fields.length)}/${fields.length}\r`);
  }
  console.log("  Done.\n");

  // --- field_mapping ---
  const mappings = queryJson<Record<string, unknown>>("SELECT * FROM field_mapping");
  console.log(`field_mapping: ${mappings.length} rows`);
  await client.begin(async (tx) => {
    for (const m of mappings) {
      await tx`
        INSERT INTO field_mapping (
          id, workspace_id, target_field_id, status, mapping_type, assignee_id,
          source_entity_id, source_field_id,
          transform, default_value, enum_mapping,
          reasoning, confidence, notes,
          created_by, generation_id, version, parent_id, is_latest,
          edited_by, change_summary,
          review_status, punt_note, batch_run_id,
          created_at, updated_at
        ) VALUES (
          ${n(m.id)}, ${rw(m.workspace_id)}, ${n(m.target_field_id)}, ${n(m.status)}, ${n(m.mapping_type)}, ${n(m.assignee_id)},
          ${n(m.source_entity_id)}, ${n(m.source_field_id)},
          ${n(m.transform)}, ${n(m.default_value)}, ${toJsonb(m.enum_mapping)},
          ${n(m.reasoning)}, ${n(m.confidence)}, ${n(m.notes)},
          ${n(m.created_by)}, ${n(m.generation_id)}, ${num(m.version)}, ${n(m.parent_id)}, ${toBool(m.is_latest)},
          ${n(m.edited_by)}, ${n(m.change_summary)},
          ${n(m.review_status)}, ${n(m.punt_note)}, ${n(m.batch_run_id)},
          ${n(m.created_at)}, ${n(m.updated_at)}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
  });
  console.log("  Done.\n");

  // Verify
  const counts = await client`
    SELECT 'schema_asset' as tbl, COUNT(*)::int as cnt FROM schema_asset
    UNION ALL SELECT 'entity', COUNT(*)::int FROM entity
    UNION ALL SELECT 'field', COUNT(*)::int FROM field
    UNION ALL SELECT 'field_mapping', COUNT(*)::int FROM field_mapping
  `;
  console.log("Verification:");
  for (const row of counts) {
    console.log(`  ${row.tbl}: ${row.cnt}`);
  }

  console.log("\nMigration complete!");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
