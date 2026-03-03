/**
 * Seed entity structure classification (flat vs assembly) from production M2 YAML data.
 *
 * Reads all M2 YAMLs from sdt_mapping and uses their source patterns to
 * definitively classify each entity:
 *   - Has `concat:` key       -> "assembly" (parent that UNIONs components)
 *   - Has any `staging:` src  -> "assembly" (component feeding into a parent)
 *   - All `pipe_file:` srcs   -> "flat" (reads directly from ACDC)
 *
 * Updates the `entity_scaffold` table with the correct topology so the
 * batch runner uses ground-truth classification instead of LLM guessing.
 *
 * Usage: npx tsx scripts/seed-structure-classification.ts [--dry-run]
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import yaml from "js-yaml";

// ── Config ────────────────────────────────────────────────────

const M2_DIR = "/Users/rob/code/sdt_mapping/acdc_to_vds/m2_mappings";
const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const DRY_RUN = process.argv.includes("--dry-run");

// ── Types ─────────────────────────────────────────────────────

interface M2Source {
  name: string;
  alias: string;
  staging?: { table: string };
  pipe_file?: { table: string };
  [key: string]: unknown;
}

interface M2Yaml {
  table: string;
  sources?: M2Source[];
  concat?: { sources: string[] };
  [key: string]: unknown;
}

type StructureKind = "assembly-parent" | "assembly-component" | "flat";

interface ClassificationResult {
  yamlFile: string;
  tableName: string;
  kind: StructureKind;
  topology: "assembly" | "single_source" | "multi_source_same_type" | "multi_source_different_type";
  stagingSources: string[];   // staging table names
  pipeFileSources: string[];  // pipe_file table names
  concatAliases: string[];    // aliases in concat.sources
}

// ── Step 1: Read & classify M2 YAMLs ─────────────────────────

function classifyYaml(filePath: string): ClassificationResult | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  let data: M2Yaml;
  try {
    data = yaml.load(raw) as M2Yaml;
  } catch (e) {
    console.warn(`  SKIP: Could not parse ${path.basename(filePath)}: ${e}`);
    return null;
  }

  if (!data || !data.table) {
    console.warn(`  SKIP: No table name in ${path.basename(filePath)}`);
    return null;
  }

  const sources = data.sources ?? [];
  const stagingSources: string[] = [];
  const pipeFileSources: string[] = [];

  for (const src of sources) {
    if (src.staging) {
      stagingSources.push(src.staging.table);
    }
    if (src.pipe_file) {
      pipeFileSources.push(src.pipe_file.table);
    }
  }

  const hasConcat = !!data.concat;
  const hasStaging = stagingSources.length > 0;
  const concatAliases = hasConcat ? (data.concat!.sources ?? []) : [];

  let kind: StructureKind;
  let topology: ClassificationResult["topology"];

  if (hasConcat) {
    kind = "assembly-parent";
    topology = "assembly";
  } else if (hasStaging) {
    kind = "assembly-component";
    topology = "assembly";
  } else {
    kind = "flat";
    // Refine flat topology based on source count
    if (pipeFileSources.length <= 1) {
      topology = "single_source";
    } else {
      topology = "multi_source_same_type";
    }
  }

  return {
    yamlFile: path.basename(filePath),
    tableName: data.table,
    kind,
    topology,
    stagingSources,
    pipeFileSources,
    concatAliases,
  };
}

// ── Main ──────────────────────────────────────────────────────

function main() {
  console.log("=== Seed Structure Classification from M2 YAMLs ===\n");

  if (DRY_RUN) {
    console.log("(DRY RUN — no DB writes)\n");
  }

  // 1. Read all YAMLs
  const yamlFiles = fs
    .readdirSync(M2_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  console.log(`Found ${yamlFiles.length} M2 YAML files\n`);

  const classifications: ClassificationResult[] = [];
  for (const file of yamlFiles) {
    const result = classifyYaml(path.join(M2_DIR, file));
    if (result) classifications.push(result);
  }

  // Summarize
  const parents = classifications.filter((c) => c.kind === "assembly-parent");
  const components = classifications.filter((c) => c.kind === "assembly-component");
  const flat = classifications.filter((c) => c.kind === "flat");

  console.log(`Classification summary:`);
  console.log(`  assembly-parent:    ${parents.length} (have concat:)`);
  console.log(`  assembly-component: ${components.length} (have staging: sources)`);
  console.log(`  flat:               ${flat.length} (all pipe_file: sources)\n`);

  // Show assembly parents with their components
  console.log("Assembly parents:");
  for (const p of parents) {
    console.log(`  ${p.tableName} <- [${p.stagingSources.join(", ")}]`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("=== Dry run complete — no DB changes made ===");

    // Print full classification list
    console.log("\nFull classification:");
    for (const c of classifications) {
      const tag = c.kind === "assembly-parent" ? "PARENT"
        : c.kind === "assembly-component" ? "COMPONENT"
        : "FLAT";
      console.log(`  [${tag.padEnd(9)}] ${c.tableName}`);
    }
    return;
  }

  // 2. Open DB and look up entities
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Ensure entity_scaffold table exists (may not have been created by migration)
  ensureScaffoldTable(db);

  const WORKSPACE_ID = (
    db.prepare("SELECT id FROM workspace LIMIT 1").get() as { id: string }
  ).id;

  console.log(`Workspace: ${WORKSPACE_ID}\n`);

  // Build a lookup: entity name -> entity id (target entities only)
  const targetEntities = db
    .prepare("SELECT id, name FROM entity WHERE workspace_id = ? AND side = 'target'")
    .all(WORKSPACE_ID) as { id: string; name: string }[];

  const entityByName = new Map<string, string>();
  for (const e of targetEntities) {
    entityByName.set(e.name, e.id);
  }

  console.log(`Target entities in DB: ${targetEntities.length}\n`);

  // 3. Upsert entity_scaffold for each classified entity
  // Also build a parent->components map for assembly parents
  const parentComponentMap = new Map<string, string[]>();
  for (const p of parents) {
    parentComponentMap.set(p.tableName, p.stagingSources);
  }

  const checkExisting = db.prepare(
    "SELECT id FROM entity_scaffold WHERE workspace_id = ? AND entity_id = ?"
  );

  const updateScaffold = db.prepare(`
    UPDATE entity_scaffold SET
      topology = ?,
      strategy_notes = ?,
      assembly_components = ?,
      primary_sources = ?,
      secondary_sources = ?,
      is_stale = 0,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const insertScaffold = db.prepare(`
    INSERT INTO entity_scaffold (
      id, workspace_id, entity_id, topology, strategy_notes,
      assembly_components, primary_sources, secondary_sources,
      excluded_sources, is_stale, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `);

  let matched = 0;
  let unmatched = 0;
  let inserted = 0;
  let updated = 0;

  const txn = db.transaction(() => {
    for (const c of classifications) {
      const entityId = entityByName.get(c.tableName);
      if (!entityId) {
        unmatched++;
        continue;
      }
      matched++;

      // Build scaffold data
      const strategyNotes = buildStrategyNotes(c);

      // For assembly parents, include component info
      let assemblyComponents: string | null = null;
      if (c.kind === "assembly-parent" && c.stagingSources.length > 0) {
        assemblyComponents = JSON.stringify(
          c.stagingSources.map((name) => ({
            name,
            description: `Staging component for ${c.tableName}`,
            sourceFieldPattern: null,
            filter: null,
          }))
        );
      }

      const primarySources = JSON.stringify(
        c.pipeFileSources.length > 0 ? c.pipeFileSources : c.stagingSources
      );
      const secondarySources = JSON.stringify(
        c.pipeFileSources.length > 0 && c.stagingSources.length > 0
          ? c.stagingSources
          : []
      );

      // Upsert
      const existing = checkExisting.get(WORKSPACE_ID, entityId) as { id: string } | undefined;

      if (existing) {
        updateScaffold.run(
          c.topology,
          strategyNotes,
          assemblyComponents,
          primarySources,
          secondarySources,
          existing.id,
        );
        updated++;
      } else {
        insertScaffold.run(
          crypto.randomUUID(),
          WORKSPACE_ID,
          entityId,
          c.topology,
          strategyNotes,
          assemblyComponents,
          primarySources,
          secondarySources,
          JSON.stringify([]),  // excluded_sources
        );
        inserted++;
      }
    }
  });

  txn();

  console.log(`Results:`);
  console.log(`  Matched to DB entities: ${matched}`);
  console.log(`  No matching entity:     ${unmatched}`);
  console.log(`  Scaffolds inserted:     ${inserted}`);
  console.log(`  Scaffolds updated:      ${updated}`);

  // Show unmatched for debugging
  if (unmatched > 0) {
    console.log(`\nUnmatched YAML tables (no target entity in DB):`);
    for (const c of classifications) {
      if (!entityByName.has(c.tableName)) {
        const tag = c.kind === "assembly-parent" ? "PARENT"
          : c.kind === "assembly-component" ? "COMPONENT"
          : "FLAT";
        console.log(`  [${tag.padEnd(9)}] ${c.tableName}`);
      }
    }
  }

  // Quick verification: count scaffolds by topology
  const topologyCounts = db
    .prepare(
      "SELECT topology, COUNT(*) as cnt FROM entity_scaffold WHERE workspace_id = ? AND is_stale = 0 GROUP BY topology"
    )
    .all(WORKSPACE_ID) as { topology: string; cnt: number }[];

  console.log(`\nScaffold topology distribution:`);
  for (const row of topologyCounts) {
    console.log(`  ${row.topology}: ${row.cnt}`);
  }

  db.close();
  console.log("\nDone.");
}

// ── Helpers ───────────────────────────────────────────────────

function ensureScaffoldTable(db: Database.Database): void {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_scaffold'")
    .get() as { name: string } | undefined;

  if (exists) {
    console.log("entity_scaffold table exists.\n");
    return;
  }

  console.log("Creating entity_scaffold table...\n");
  db.exec(`
    CREATE TABLE entity_scaffold (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
      topology TEXT NOT NULL DEFAULT 'single_source',
      source_tables TEXT,
      assembly_components TEXT,
      strategy_notes TEXT,
      primary_sources TEXT,
      secondary_sources TEXT,
      excluded_sources TEXT,
      is_stale INTEGER NOT NULL DEFAULT 0,
      generation_id TEXT,
      batch_run_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX entity_scaffold_entity_idx ON entity_scaffold(entity_id);
    CREATE INDEX entity_scaffold_workspace_idx ON entity_scaffold(workspace_id);
  `);
}

function buildStrategyNotes(c: ClassificationResult): string {
  const lines: string[] = [];

  lines.push(`Seeded from M2 production YAML: ${c.yamlFile}`);

  switch (c.kind) {
    case "assembly-parent":
      lines.push(
        `Assembly parent — UNIONs ${c.stagingSources.length} staging components: ${c.stagingSources.join(", ")}`
      );
      break;
    case "assembly-component":
      lines.push(
        `Assembly component — reads from staging tables: ${c.stagingSources.join(", ")}` +
        (c.pipeFileSources.length > 0
          ? ` and ACDC pipe files: ${c.pipeFileSources.join(", ")}`
          : "")
      );
      break;
    case "flat":
      lines.push(
        `Flat entity — reads directly from ACDC pipe files: ${c.pipeFileSources.join(", ")}`
      );
      break;
  }

  return lines.join(". ");
}

main();
