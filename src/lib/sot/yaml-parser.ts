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

/** Resolved ACDC sources for a staging component used by an assembly parent */
export interface StagingComponentDetail {
  componentName: string;
  acdcSources: string[]; // pipe_file table names used by the component
  columns: SotColumn[];  // the component's field mappings (with ACDC-resolved sources)
}

export interface SotEntityMapping {
  table: string;
  version: number;
  primaryKey: string[];
  sources: SotSource[];
  joins: SotJoin[];
  columns: SotColumn[];
  rawYaml: string;
  /** For assembly parents: resolved ACDC sources from each staging component */
  stagingDetail?: StagingComponentDetail[];
}

export interface SotEntitySummary {
  name: string;
  milestone: "m1" | "m2";
  fieldCount: number;
  sourceCount: number;
  structureType: "concat" | "join" | "simple";
  /** True if this entity is an assembly parent (has concat key) */
  isAssemblyParent: boolean;
  /** Names of staging components this parent assembles from */
  stagingComponents: string[];
  /** True if this entity is a staging component referenced by a parent's concat */
  isStagingComponent: boolean;
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
  const mapping = parseSotYaml(yamlText);

  // For assembly parents: resolve staging component details to show ACDC sources
  const stagingSources = mapping.sources.filter((s) => s.sourceType === "staging");
  if (stagingSources.length > 0) {
    const stagingDetail: StagingComponentDetail[] = [];
    for (const staging of stagingSources) {
      const componentPath = path.join(sotDir, milestoneDir, `${staging.table}.yaml`);
      if (!fs.existsSync(componentPath)) continue;
      try {
        const compYaml = fs.readFileSync(componentPath, "utf-8");
        const comp = parseSotYaml(compYaml);
        const acdcSources = comp.sources
          .filter((s) => s.sourceType === "pipe_file")
          .map((s) => s.table);
        stagingDetail.push({
          componentName: staging.table,
          acdcSources,
          columns: comp.columns,
        });
      } catch {
        // Skip malformed component YAMLs
      }
    }
    if (stagingDetail.length > 0) {
      mapping.stagingDetail = stagingDetail;
    }
  }

  return mapping;
}

export function listSotEntities(): SotEntitySummary[] {
  const sotDir = getSotDir();
  const summaries: SotEntitySummary[] = [];

  // Pass 1: build table→filename map (handles mismatches like borrower_comortgr file vs borrower_comrtgr table)
  const allStagingComponents = new Set<string>();
  const parentComponents = new Map<string, string[]>();
  const allEntityNames = new Map<string, Set<string>>();
  const tableToFile = new Map<string, string>(); // "milestone:tableName" → fileName

  for (const milestone of ["m1", "m2"] as const) {
    const milestoneDir = milestone === "m1" ? "m1_mappings" : "m2_mappings";
    const dirPath = path.join(sotDir, milestoneDir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".yaml"));
    allEntityNames.set(milestone, new Set(files.map((f) => f.replace(".yaml", ""))));

    for (const file of files) {
      const fileName = file.replace(".yaml", "");
      try {
        const text = fs.readFileSync(path.join(dirPath, file), "utf-8");
        const data = yaml.load(text) as Record<string, unknown>;
        const tableName = data.table as string | undefined;
        // Always map both directions: table→file and file→file
        tableToFile.set(`${milestone}:${fileName}`, fileName);
        if (tableName) {
          tableToFile.set(`${milestone}:${tableName}`, fileName);
        }
      } catch { /* skip */ }
    }
  }

  // Pass 1b: identify assembly parents and their staging components.
  // Also scan for staging references that are suffix-variants of an assembly parent
  // (e.g., loan1 is a variant of loan, borrower_comrtgr of borrower).
  // Entities like foreclosure/loan that are standalone but consumed as staging
  // dependencies by other entities should NOT be hidden.
  const assemblyParentNames = new Set<string>(); // milestone:name

  for (const milestone of ["m1", "m2"] as const) {
    const milestoneDir = milestone === "m1" ? "m1_mappings" : "m2_mappings";
    const dirPath = path.join(sotDir, milestoneDir);
    if (!fs.existsSync(dirPath)) continue;

    // First identify all assembly parents (have concat:)
    for (const file of fs.readdirSync(dirPath).filter((f) => f.endsWith(".yaml"))) {
      const entityName = file.replace(".yaml", "");
      try {
        const text = fs.readFileSync(path.join(dirPath, file), "utf-8");
        const data = yaml.load(text) as Record<string, unknown>;
        if (data.concat) {
          assemblyParentNames.add(`${milestone}:${entityName}`);
          const sources = (data.sources || []) as { staging?: { table: string } }[];
          const components: string[] = [];
          for (const s of sources) {
            if (s.staging?.table) {
              const resolvedFile = tableToFile.get(`${milestone}:${s.staging.table}`) || s.staging.table;
              if (!components.includes(resolvedFile)) {
                components.push(resolvedFile);
              }
              allStagingComponents.add(`${milestone}:${resolvedFile}`);
            }
          }
          parentComponents.set(`${milestone}:${entityName}`, components);
        }
      } catch { /* skip */ }
    }

    // Now find staging components that are suffix-variants or numbered variants
    // of entities that consume them. Two patterns:
    // 1. Assembly parent (concat) variants: loan_tax_installment_3 under loan_tax_installment
    // 2. Non-concat staging: loan1 under loan (loan reads staging:{table:"loan1"})

    // Build map: which entities consume which staging tables (all consumers, not just last)
    const consumedBy = new Map<string, string[]>(); // resolvedFileName → consumer entityNames
    for (const file of fs.readdirSync(dirPath).filter((f) => f.endsWith(".yaml"))) {
      const entityName = file.replace(".yaml", "");
      try {
        const text = fs.readFileSync(path.join(dirPath, file), "utf-8");
        const data = yaml.load(text) as Record<string, unknown>;
        const sources = (data.sources || []) as { staging?: { table: string } }[];
        for (const s of sources) {
          if (s.staging?.table) {
            const resolvedFile = tableToFile.get(`${milestone}:${s.staging.table}`) || s.staging.table;
            if (!consumedBy.has(resolvedFile)) consumedBy.set(resolvedFile, []);
            consumedBy.get(resolvedFile)!.push(entityName);
          }
        }
      } catch { /* skip */ }
    }

    // Mark suffix/numbered variants as staging when consumed by their parent-like entity
    const names = allEntityNames.get(milestone);
    if (names) {
      for (const entityName of names) {
        if (allStagingComponents.has(`${milestone}:${entityName}`)) continue;
        if (assemblyParentNames.has(`${milestone}:${entityName}`)) continue;

        const consumers = consumedBy.get(entityName);
        if (!consumers) continue;

        // Check if entityName is a variant of ANY consumer: consumer_suffix or consumerN
        for (const consumer of consumers) {
          const numberedPattern = new RegExp("^" + consumer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\d+$");
          if (entityName.startsWith(consumer + "_") || numberedPattern.test(entityName)) {
            allStagingComponents.add(`${milestone}:${entityName}`);
            const parentKey = `${milestone}:${consumer}`;
            const components = parentComponents.get(parentKey) || [];
            if (!components.includes(entityName)) {
              components.push(entityName);
              parentComponents.set(parentKey, components);
            }
            break;
          }
        }
      }
    }

    // Also scan for entities referenced as staging by concat parents
    // that we missed due to table name mismatches
    for (const [parentKey, components] of parentComponents) {
      if (!parentKey.startsWith(`${milestone}:`)) continue;
      const parentName = parentKey.slice(milestone.length + 1);
      const parentPath = path.join(dirPath, `${parentName}.yaml`);
      try {
        const parentText = fs.readFileSync(parentPath, "utf-8");
        const names = allEntityNames.get(milestone);
        if (!names) continue;
        for (const name of names) {
          if (allStagingComponents.has(`${milestone}:${name}`)) continue;
          // Check if parent YAML text mentions this entity name
          if (name.startsWith(parentName + "_") && parentText.includes(name)) {
            allStagingComponents.add(`${milestone}:${name}`);
            if (!components.includes(name)) components.push(name);
          }
        }
      } catch { /* skip */ }
    }
  }

  // Second pass: build summaries with staging info
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

        const key = `${milestone}:${entityName}`;
        const isAssemblyParent = parentComponents.has(key);
        const isStagingComponent = allStagingComponents.has(key);

        summaries.push({
          name: entityName,
          milestone,
          fieldCount: rawColumns.length,
          sourceCount: rawSources.length,
          structureType,
          isAssemblyParent,
          stagingComponents: parentComponents.get(key) || [],
          isStagingComponent,
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
