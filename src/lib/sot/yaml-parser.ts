import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const DEFAULT_SOT_DIR = "/Users/rob/code/sdt_mapping/acdc_to_vds";

function getSotDir(): string {
  return process.env.SOT_MAPPING_DIR || DEFAULT_SOT_DIR;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SotSource {
  name: string;
  alias: string;
  table: string;
  sourceType: "pipe_file" | "staging";
}

export interface SotJoin {
  left: string;
  right: string;
  on: string[];
  how: string;
}

export interface SotColumn {
  targetColumn: string;
  resolvedSources: string[];
  transform: string | null;
  expression: string | null;
  dtype: string | null;
  hashColumns: string[] | null;
}

export interface SotEntityMapping {
  table: string;
  version: number;
  primaryKey: string[];
  sources: SotSource[];
  joins: SotJoin[];
  columns: SotColumn[];
  rawYaml: string;
}

export interface SotEntitySummary {
  name: string;
  milestone: "m1" | "m2";
  fieldCount: number;
  sourceCount: number;
  structureType: "concat" | "join" | "simple";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build alias -> resolved table name map from sources */
function buildAliasMap(
  sources: SotSource[]
): Map<string, { table: string; sourceType: "pipe_file" | "staging" }> {
  const map = new Map<
    string,
    { table: string; sourceType: "pipe_file" | "staging" }
  >();
  for (const src of sources) {
    map.set(src.alias, { table: src.table, sourceType: src.sourceType });
  }
  return map;
}

/** Resolve "alias.Column" -> "Table.Column" using the alias map */
function resolveRef(
  ref: string,
  aliasMap: Map<string, { table: string; sourceType: "pipe_file" | "staging" }>
): string | null {
  const dotIdx = ref.indexOf(".");
  if (dotIdx === -1) return null;
  const alias = ref.substring(0, dotIdx);
  const column = ref.substring(dotIdx + 1);
  const entry = aliasMap.get(alias);
  if (!entry) return null;
  return `${entry.table}.${column}`;
}

/** Parse the sources array from raw YAML data */
function parseSources(rawSources: unknown[]): SotSource[] {
  const sources: SotSource[] = [];
  for (const raw of rawSources) {
    const src = raw as Record<string, unknown>;
    const name = src.name as string;
    const alias = src.alias as string;

    if (src.pipe_file) {
      const pf = src.pipe_file as Record<string, string>;
      sources.push({ name, alias, table: pf.table, sourceType: "pipe_file" });
    } else if (src.staging) {
      const st = src.staging as Record<string, string>;
      sources.push({ name, alias, table: st.table, sourceType: "staging" });
    }
  }
  return sources;
}

/** Parse the joins array from raw YAML data */
function parseJoins(rawJoins: unknown[] | undefined): SotJoin[] {
  if (!rawJoins) return [];
  return rawJoins.map((raw) => {
    const j = raw as Record<string, unknown>;
    const left = j.left as Record<string, string>;
    const right = j.right as Record<string, string>;
    return {
      left: left.source,
      right: right.source,
      on: (j.on as string[]) || [],
      how: (j.how as string) || "left",
    };
  });
}

/** Detect structure type from raw YAML data */
function detectStructureType(
  data: Record<string, unknown>
): "concat" | "join" | "simple" {
  if (data.concat) return "concat";
  if (data.joins) return "join";
  return "simple";
}

// ---------------------------------------------------------------------------
// Core parse function
// ---------------------------------------------------------------------------

export function parseSotYaml(yamlText: string): SotEntityMapping {
  const data = yaml.load(yamlText) as Record<string, unknown>;

  const table = (data.table as string) || "";
  const version = (data.version as number) || 1;
  const primaryKey = (data.primary_key as string[]) || [];

  const sources = parseSources((data.sources as unknown[]) || []);
  const aliasMap = buildAliasMap(sources);
  const joins = parseJoins(data.joins as unknown[] | undefined);

  const rawColumns = (data.columns as unknown[]) || [];
  const columns: SotColumn[] = rawColumns.map((raw) => {
    const col = raw as Record<string, unknown>;
    const targetColumn = col.target_column as string;
    const transform = (col.transform as string) || null;
    const expression = (col.expression as string) || null;
    const dtype = (col.dtype as string) || null;
    const hashColumnsRaw = (col.hash_columns as string[]) || null;

    const resolvedSources: string[] = [];

    if (transform === "hash_id" && hashColumnsRaw) {
      // hash_id: resolve each hash_column that contains a dot
      for (const hc of hashColumnsRaw) {
        if (hc.includes(".")) {
          const resolved = resolveRef(hc, aliasMap);
          if (resolved) resolvedSources.push(resolved);
        }
        // Skip literals (no dot)
      }
    } else if (transform === "expression" && expression) {
      // expression: regex match alias.Column references
      const refPattern = /\b([a-zA-Z_]\w*)\.([A-Z][A-Za-z0-9_]*)\b/g;
      let match: RegExpExecArray | null;
      while ((match = refPattern.exec(expression)) !== null) {
        const alias = match[1];
        // Only resolve if alias is in the known alias map
        // This skips np.select, pd.NA, etc. since "np", "pd" won't be aliases
        if (aliasMap.has(alias)) {
          const resolved = resolveRef(`${match[1]}.${match[2]}`, aliasMap);
          if (resolved) resolvedSources.push(resolved);
        }
      }
    } else if (col.source !== undefined) {
      // source: "alias.Column" or source: [] or source: {literal: "..."}
      const source = col.source;
      if (typeof source === "string" && source.includes(".")) {
        const resolved = resolveRef(source, aliasMap);
        if (resolved) resolvedSources.push(resolved);
      }
      // source: [] or source: {literal: ...} → empty resolvedSources
    }

    // Deduplicate
    const unique = [...new Set(resolvedSources)];

    return {
      targetColumn,
      resolvedSources: unique,
      transform,
      expression,
      dtype,
      hashColumns: hashColumnsRaw,
    };
  });

  return {
    table,
    version,
    primaryKey,
    sources,
    joins,
    columns,
    rawYaml: yamlText,
  };
}

// ---------------------------------------------------------------------------
// Filesystem loaders
// ---------------------------------------------------------------------------

export function loadSotEntity(
  entityName: string,
  milestone: "m1" | "m2" = "m1"
): SotEntityMapping | null {
  const sotDir = getSotDir();
  const milestoneDir = milestone === "m1" ? "m1_mappings" : "m2_mappings";
  const filePath = path.join(sotDir, milestoneDir, `${entityName}.yaml`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const yamlText = fs.readFileSync(filePath, "utf-8");
  return parseSotYaml(yamlText);
}

export function listSotEntities(): SotEntitySummary[] {
  const sotDir = getSotDir();
  const summaries: SotEntitySummary[] = [];

  for (const milestone of ["m1", "m2"] as const) {
    const milestoneDir =
      milestone === "m1" ? "m1_mappings" : "m2_mappings";
    const dirPath = path.join(sotDir, milestoneDir);

    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".yaml"));

    for (const file of files) {
      const entityName = file.replace(".yaml", "");
      const filePath = path.join(dirPath, file);

      try {
        const yamlText = fs.readFileSync(filePath, "utf-8");
        const data = yaml.load(yamlText) as Record<string, unknown>;

        const rawColumns = (data.columns as unknown[]) || [];
        const rawSources = (data.sources as unknown[]) || [];
        const structureType = detectStructureType(data);

        summaries.push({
          name: entityName,
          milestone,
          fieldCount: rawColumns.length,
          sourceCount: rawSources.length,
          structureType,
        });
      } catch {
        // Skip malformed YAML files
      }
    }
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find SOT entities in the same domain as the given entity.
 * Uses name-prefix matching: `loss_mitigation_loan_modification` shares
 * the prefix `loss_mitigation` with `loss_mitigation_forbearance`, etc.
 *
 * Returns the richest (most fields) related entities, excluding the entity itself.
 * Tries progressively shorter prefixes until a group with 2+ members is found.
 */
export function findRelatedSotEntities(
  entityName: string,
  limit: number = 3,
): SotEntityMapping[] {
  const allEntities = listSotEntities();
  const segments = entityName.split("_");

  // Try progressively shorter prefixes
  // Start from full name (finds foreclosure_bid for "foreclosure"),
  // then shorten (finds loss_mitigation_forbearance for "loss_mitigation_loan_modification")
  let matchedNames: string[] = [];
  for (let prefixLen = segments.length; prefixLen >= 1; prefixLen--) {
    const prefix = segments.slice(0, prefixLen).join("_") + "_";
    const matches = allEntities.filter(
      (e) => e.name !== entityName && e.name.startsWith(prefix),
    );
    if (matches.length >= 1) {
      // Sort by field count descending — richest mappings most useful
      matches.sort((a, b) => b.fieldCount - a.fieldCount);
      // Deduplicate by name (entity may appear in both M1 and M2 — prefer M2)
      const seen = new Set<string>();
      matchedNames = [];
      for (const m of matches) {
        if (!seen.has(m.name)) {
          seen.add(m.name);
          matchedNames.push(m.name);
        }
      }
      break;
    }
  }

  // Load the top N as full SotEntityMapping
  const results: SotEntityMapping[] = [];
  for (const name of matchedNames.slice(0, limit)) {
    const sot = loadSotEntity(name, "m2") || loadSotEntity(name, "m1");
    if (sot) results.push(sot);
  }

  return results;
}
