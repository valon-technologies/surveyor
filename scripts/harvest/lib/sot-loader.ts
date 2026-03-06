/**
 * SOT YAML loader: reads M1/M2 mapping YAML files from the analytics repo
 * and builds a lookup map keyed by "entity.field".
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { load as parseYaml } from "js-yaml";
import type { SotMapping } from "./types";

const MAPPING_DIRS: Record<string, string> = {
  M1: "/Users/rob/code/analytics/analytics/platform/sdt_mapping/m1_mappings",
  M2: "/Users/rob/code/analytics/analytics/platform/sdt_mapping/m2_mappings",
};

interface YamlSource {
  name: string;
  alias: string;
  staging: { table: string };
}

interface YamlColumn {
  target_column: string;
  source?: string;
  expression?: string;
  transform: string;
  dtype: string;
}

interface YamlMapping {
  table: string;
  sources?: YamlSource[];
  columns?: YamlColumn[];
}

function parseFile(filePath: string): SotMapping[] {
  const raw = readFileSync(filePath, "utf-8");
  const doc = parseYaml(raw) as YamlMapping;
  if (!doc || !doc.table || !doc.columns) return [];

  const entityName = doc.table;
  const sources = (doc.sources ?? []).map((s) => ({
    name: s.name,
    alias: s.alias,
    staging: typeof s.staging === "object" ? s.staging.table : String(s.staging),
  }));

  return doc.columns.map((col) => ({
    entity: entityName,
    field: col.target_column,
    sources,
    transform: col.transform,
    dtype: col.dtype,
    sourceColumn: col.source ?? null,
  }));
}

/**
 * Load all SOT mappings for a milestone and return a Map keyed by "entity.field".
 */
export function loadSotMappings(milestone: "M1" | "M2"): Map<string, SotMapping> {
  const dir = MAPPING_DIRS[milestone];
  if (!dir) throw new Error(`Unknown milestone: ${milestone}`);

  const map = new Map<string, SotMapping>();
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    try {
      const mappings = parseFile(join(dir, file));
      for (const m of mappings) {
        map.set(`${m.entity}.${m.field}`, m);
      }
    } catch (err) {
      console.warn(`Warning: failed to parse ${file}: ${(err as Error).message}`);
    }
  }

  console.log(`Loaded ${map.size} SOT mappings for ${milestone} from ${files.length} files`);
  return map;
}

/**
 * Look up a SOT mapping by entity and field name.
 */
export function findSotMapping(
  lookup: Map<string, SotMapping>,
  entityName: string,
  fieldName: string,
): SotMapping | undefined {
  return lookup.get(`${entityName}.${fieldName}`);
}
