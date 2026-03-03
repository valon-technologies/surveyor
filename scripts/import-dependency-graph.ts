/**
 * Import production dependency graph from analytics repo's sdt_mapping_config.yaml.
 *
 * Reads the YAML config, extracts entity dependency relationships, and writes
 * a JSON lookup file that Surveyor's dependency-graph.ts can use for authoritative
 * ordering (instead of heuristic *_id pattern matching).
 *
 * Usage:
 *   npx tsx scripts/import-dependency-graph.ts
 *   npx tsx scripts/import-dependency-graph.ts /path/to/sdt_mapping_config.yaml
 *   npx tsx scripts/import-dependency-graph.ts --dry-run   # print without writing
 *   npx tsx scripts/import-dependency-graph.ts --check-db   # also report DB entity coverage
 *
 * Output: src/lib/generation/production-dependencies.json
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import * as yaml from "js-yaml";

// ── Parse args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkDb = args.includes("--check-db");
const positionalArgs = args.filter((a) => !a.startsWith("--"));

const DEFAULT_YAML_PATH = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../../analytics/analytics/airflow/dags/sdt_mapping_config.yaml",
);
const yamlPath = positionalArgs[0] ?? DEFAULT_YAML_PATH;
const outputPath = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../src/lib/generation/production-dependencies.json",
);

// ── Load and parse YAML ─────────────────────────────────────
console.log(`Reading: ${yamlPath}`);
let rawYaml: string;
try {
  rawYaml = readFileSync(yamlPath, "utf-8");
} catch (err) {
  console.error(`Failed to read YAML file: ${yamlPath}`);
  console.error((err as Error).message);
  process.exit(1);
}

interface YamlTableEntry {
  mapping_file: string;
  dependencies: string[];
  heavy?: boolean;
  config_dirs?: string[];
}

interface YamlConfig {
  version: number;
  description: string;
  tables: Record<string, YamlTableEntry>;
}

const config = yaml.load(rawYaml) as YamlConfig;

if (!config?.tables) {
  console.error("Invalid config: missing 'tables' key");
  process.exit(1);
}

// ── Build dependency map ────────────────────────────────────
// Map: entity name -> list of entity names it depends on
const dependencyMap: Record<string, string[]> = {};
const allEntityNames = new Set<string>();

for (const [tableName, tableConfig] of Object.entries(config.tables)) {
  allEntityNames.add(tableName);
  const deps = tableConfig.dependencies ?? [];
  dependencyMap[tableName] = deps;
  // Also track dependency names for coverage check
  for (const dep of deps) {
    allEntityNames.add(dep);
  }
}

// ── Validate: every dependency target should also be a table ─
const tableNames = new Set(Object.keys(config.tables));
const missingTables: string[] = [];
for (const [tableName, deps] of Object.entries(dependencyMap)) {
  for (const dep of deps) {
    if (!tableNames.has(dep)) {
      missingTables.push(`${tableName} -> ${dep}`);
    }
  }
}

// ── Build output structure ──────────────────────────────────
interface ProductionDependencies {
  version: number;
  source: string;
  importedAt: string;
  entityCount: number;
  dependencies: Record<string, string[]>;
}

const output: ProductionDependencies = {
  version: 1,
  source: "analytics/airflow/dags/sdt_mapping_config.yaml",
  importedAt: new Date().toISOString(),
  entityCount: Object.keys(dependencyMap).length,
  dependencies: dependencyMap,
};

// ── Summary ─────────────────────────────────────────────────
const totalDeps = Object.values(dependencyMap).reduce((sum, deps) => sum + deps.length, 0);
const rootEntities = Object.entries(dependencyMap)
  .filter(([, deps]) => deps.length === 0)
  .map(([name]) => name);
const maxDeps = Object.entries(dependencyMap).reduce(
  (max, [name, deps]) => (deps.length > max.count ? { name, count: deps.length } : max),
  { name: "", count: 0 },
);

console.log(`\nProduction dependency graph summary:`);
console.log(`  Entities: ${output.entityCount}`);
console.log(`  Total dependency edges: ${totalDeps}`);
console.log(`  Root entities (no deps): ${rootEntities.length} — ${rootEntities.join(", ")}`);
console.log(`  Max dependencies: ${maxDeps.name} (${maxDeps.count} deps)`);

if (missingTables.length > 0) {
  console.warn(`\n  WARNING: ${missingTables.length} dependencies reference tables not in config:`);
  for (const mt of missingTables) {
    console.warn(`    ${mt}`);
  }
}

// ── Optional: check DB coverage ─────────────────────────────
if (checkDb) {
  (async () => {
    // Load .env.local for DB access
    try {
      for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
        const match = line.match(/^([^#=]+)=(.*)/);
        if (match) process.env[match[1].trim()] = match[2].trim();
      }
    } catch {
      // .env.local not required for DB check on SQLite
    }

    // Dynamic import to avoid loading DB when not needed
    const { db } = await import("../src/lib/db");
    const { entity } = await import("../src/lib/db/schema");
    const { eq, and } = await import("drizzle-orm");

    // Get first workspace
    const firstEntity = db.select().from(entity).limit(1).get();
    if (!firstEntity) {
      console.warn("\n  No entities in DB -- skipping coverage check");
    } else {
      const workspaceId = firstEntity.workspaceId;
      const targetEntities = db
        .select()
        .from(entity)
        .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
        .all();

      const dbEntityNames = new Set(targetEntities.map((e) => e.name));
      const configEntityNames = new Set(Object.keys(dependencyMap));

      const inConfigNotDb = [...configEntityNames].filter((n) => !dbEntityNames.has(n));
      const inDbNotConfig = [...dbEntityNames].filter((n) => !configEntityNames.has(n));
      const overlap = [...configEntityNames].filter((n) => dbEntityNames.has(n));

      console.log(`\n  DB coverage (workspace ${workspaceId}):`);
      console.log(`    Target entities in DB: ${targetEntities.length}`);
      console.log(`    Matched (config + DB): ${overlap.length}`);
      if (inDbNotConfig.length > 0) {
        console.log(`    In DB but not in config: ${inDbNotConfig.length} — ${inDbNotConfig.join(", ")}`);
      }
      if (inConfigNotDb.length > 0) {
        console.log(`    In config but not in DB: ${inConfigNotDb.length}`);
      }
    }
  })();
}

// ── Write output ────────────────────────────────────────────
if (dryRun) {
  console.log(`\n[dry-run] Would write to: ${outputPath}`);
  console.log(JSON.stringify(output, null, 2).slice(0, 500) + "...");
} else {
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`\nWrote: ${outputPath}`);
}
