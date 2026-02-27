/**
 * Import all VDS target entities + ACDC source tables into Surveyor.
 *
 * - VDS: 195 entities / 2581 fields from vds_live_schema CSV
 * - ACDC: 38 source tables from BQ schema cache JSONs
 *
 * Idempotent — skips entities that already exist by name+side.
 *
 * Usage: npx tsx scripts/import-all-entities.ts
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ME_ROOT = "/Users/rob/code/mapping-engine";
const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const WORKSPACE_ID = (
  db.prepare("SELECT id FROM workspace LIMIT 1").get() as { id: string }
).id;

console.log(`Workspace: ${WORKSPACE_ID}\n`);

// ── Existing entities to skip ──────────────────────────────────

const existingEntities = new Set(
  (db.prepare("SELECT name || '|' || side FROM entity WHERE workspace_id = ?").all(WORKSPACE_ID) as { "name || '|' || side": string }[])
    .map((r) => r["name || '|' || side"])
);

console.log(`Existing entities: ${existingEntities.size}\n`);

// ── Schema asset lookup/creation ───────────────────────────────

function getOrCreateSchemaAsset(name: string, side: string, format: string): string {
  const existing = db.prepare(
    "SELECT id FROM schema_asset WHERE workspace_id = ? AND name = ?"
  ).get(WORKSPACE_ID, name) as { id: string } | undefined;

  if (existing) return existing.id;

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO schema_asset (id, workspace_id, name, side, format, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, WORKSPACE_ID, name, side, format);

  return id;
}

// ═══════════════════════════════════════════════════════════════
// 1. VDS TARGET ENTITIES
// ═══════════════════════════════════════════════════════════════

function importVdsEntities() {
  const csvPath = path.join(ME_ROOT, "skills/vds_live_schema_2026-02-10.csv");
  if (!fs.existsSync(csvPath)) {
    console.warn("VDS schema CSV not found, skipping.");
    return;
  }

  console.log("=== Importing VDS target entities ===\n");

  const assetId = getOrCreateSchemaAsset("VDS Schema (Full)", "target", "csv");

  // Simple CSV parsing (no papaparse dependency needed for this script)
  const lines = fs.readFileSync(csvPath, "utf-8").split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());

  const colIdx = (name: string) => headers.findIndex((h) => h === name);
  const domainIdx = colIdx("Domain");
  const entityIdx = colIdx("Entity Name");
  const fieldIdx = colIdx("Field Name");
  const defIdx = colIdx("Definition");
  const pkIdx = colIdx("Primary Key");
  const reqIdx = colIdx("Is Required");
  const enumIdx = colIdx("Enum Values");
  const typeIdx = colIdx("Type");
  const m1Idx = colIdx("In M1 Implementation Population");

  // Group fields by entity
  const entityMap = new Map<string, {
    domain: string;
    fields: Array<{
      name: string;
      dataType: string;
      description: string;
      isRequired: boolean;
      isKey: boolean;
      enumValues: string[] | null;
      milestone: string | null;
    }>;
  }>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle CSV with possible commas in quoted fields
    const cols = parseCSVLine(line);
    const entityName = cols[entityIdx]?.trim();
    const fieldName = cols[fieldIdx]?.trim();
    if (!entityName || !fieldName) continue;

    if (!entityMap.has(entityName)) {
      entityMap.set(entityName, {
        domain: cols[domainIdx]?.trim() || "",
        fields: [],
      });
    }

    const isM1 = cols[m1Idx]?.trim().toUpperCase() === "Y";

    entityMap.get(entityName)!.fields.push({
      name: fieldName,
      dataType: cols[typeIdx]?.trim() || "varchar",
      description: cols[defIdx]?.trim() || "",
      isRequired: cols[reqIdx]?.trim().toUpperCase() === "YES",
      isKey: cols[pkIdx]?.trim().toUpperCase() === "YES",
      enumValues: cols[enumIdx]?.trim() ? cols[enumIdx].trim().split("|").map((s) => s.trim()) : null,
      milestone: isM1 ? "M1" : null,
    });
  }

  let entitiesCreated = 0;
  let fieldsCreated = 0;
  let skipped = 0;

  const insertEntity = db.prepare(`
    INSERT INTO entity (id, workspace_id, schema_asset_id, name, side, description, domain_tags, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'target', ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const insertField = db.prepare(`
    INSERT INTO field (id, entity_id, name, data_type, description, is_required, is_key, enum_values, milestone, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const txn = db.transaction(() => {
    let sortOrder = 0;
    for (const [entityName, data] of entityMap) {
      if (existingEntities.has(`${entityName}|target`)) {
        skipped++;
        continue;
      }

      const entityId = crypto.randomUUID();
      const domainTags = data.domain ? JSON.stringify([data.domain]) : null;
      insertEntity.run(entityId, WORKSPACE_ID, assetId, entityName, null, domainTags, sortOrder++);
      entitiesCreated++;

      for (let j = 0; j < data.fields.length; j++) {
        const f = data.fields[j];
        const fieldId = crypto.randomUUID();
        const enumVals = f.enumValues ? JSON.stringify(f.enumValues) : null;
        insertField.run(fieldId, entityId, f.name, f.dataType, f.description, f.isRequired ? 1 : 0, f.isKey ? 1 : 0, enumVals, f.milestone, j);
        fieldsCreated++;
      }
    }
  });

  txn();
  console.log(`VDS: ${entitiesCreated} entities created (${fieldsCreated} fields), ${skipped} skipped\n`);
}

// ═══════════════════════════════════════════════════════════════
// 2. ACDC SOURCE TABLES
// ═══════════════════════════════════════════════════════════════

function importAcdcSources() {
  const schemaDir = path.join(ME_ROOT, "cache/bq_schema");
  if (!fs.existsSync(schemaDir)) {
    console.warn("ACDC schema cache not found, skipping.");
    return;
  }

  console.log("=== Importing ACDC source tables ===\n");

  const assetId = getOrCreateSchemaAsset("ACDC Schema (Full)", "source", "json");

  const jsonFiles = fs.readdirSync(schemaDir)
    .filter((f) => f.endsWith(".json") && f !== "summary.json");

  let entitiesCreated = 0;
  let fieldsCreated = 0;
  let skipped = 0;

  const insertEntity = db.prepare(`
    INSERT INTO entity (id, workspace_id, schema_asset_id, name, side, description, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'source', ?, ?, datetime('now'), datetime('now'))
  `);

  const insertField = db.prepare(`
    INSERT INTO field (id, entity_id, name, data_type, description, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const txn = db.transaction(() => {
    for (let i = 0; i < jsonFiles.length; i++) {
      const file = jsonFiles[i];
      const tableName = path.basename(file, ".json");

      if (existingEntities.has(`${tableName}|source`)) {
        skipped++;
        continue;
      }

      const raw = JSON.parse(fs.readFileSync(path.join(schemaDir, file), "utf-8"));
      const fields: { column_name: string; data_type: string; is_nullable: string }[] = raw.fields || [];
      const meta = raw._meta || {};

      const entityId = crypto.randomUUID();
      const desc = `ACDC source table: ${meta.project || "service-mac-prod"}.${meta.dataset || "raw_acdc_m1"}.${tableName} (${fields.length} columns)`;
      insertEntity.run(entityId, WORKSPACE_ID, assetId, tableName, desc, i);
      entitiesCreated++;

      for (let j = 0; j < fields.length; j++) {
        const f = fields[j];
        const fieldId = crypto.randomUUID();
        insertField.run(fieldId, entityId, f.column_name, f.data_type, null, j);
        fieldsCreated++;
      }
    }
  });

  txn();
  console.log(`ACDC: ${entitiesCreated} source tables created (${fieldsCreated} fields), ${skipped} skipped\n`);
}

// ── CSV line parser (handles quoted fields) ────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════

importVdsEntities();
importAcdcSources();

// Summary
const entityCount = (db.prepare("SELECT COUNT(*) as cnt FROM entity WHERE workspace_id = ?").get(WORKSPACE_ID) as { cnt: number }).cnt;
const fieldCount = (db.prepare("SELECT COUNT(*) as cnt FROM field f JOIN entity e ON f.entity_id = e.id WHERE e.workspace_id = ?").get(WORKSPACE_ID) as { cnt: number }).cnt;
const targetCount = (db.prepare("SELECT COUNT(*) as cnt FROM entity WHERE workspace_id = ? AND side = 'target'").get(WORKSPACE_ID) as { cnt: number }).cnt;
const sourceCount = (db.prepare("SELECT COUNT(*) as cnt FROM entity WHERE workspace_id = ? AND side = 'source'").get(WORKSPACE_ID) as { cnt: number }).cnt;

console.log("═".repeat(50));
console.log(`Total: ${entityCount} entities (${targetCount} target, ${sourceCount} source), ${fieldCount} fields`);
console.log("═".repeat(50));

db.close();
