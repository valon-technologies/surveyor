import type {
  EntityPipelineWithColumns,
  PipelineColumn,
  PipelineJoin,
  PipelineSource,
} from "@/types/pipeline";

/**
 * Defensively extract a string from a value that may be an object
 * (e.g. when LLM-generated YAML stores join.right as {alias:"fi", pipe_file:{table:"X"}}).
 */
function asString(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.source === "string") return obj.source;
    if (typeof obj.alias === "string") return obj.alias;
    if (typeof obj.name === "string") return obj.name;
    if (typeof obj.table === "string") return obj.table;
    if (obj.pipe_file && typeof obj.pipe_file === "object") {
      const pf = obj.pipe_file as Record<string, unknown>;
      if (typeof pf.table === "string") return pf.table;
    }
    if (obj.staging && typeof obj.staging === "object") {
      const st = obj.staging as Record<string, unknown>;
      if (typeof st.table === "string") return st.table;
    }
  }
  return fallback;
}

/**
 * Renders an EntityPipeline as best-effort BigQuery SQL.
 * Pure function — no DB or server dependencies.
 */
export function renderPipelineSql(pipeline: EntityPipelineWithColumns): string {
  const header = `-- Pipeline: ${pipeline.tableName} v${pipeline.version} | ${pipeline.structureType} | ${pipeline.sources.length} source${pipeline.sources.length !== 1 ? "s" : ""}`;

  if (pipeline.structureType === "assembly" && pipeline.concat) {
    return renderAssembly(pipeline, header);
  }
  return renderFlat(pipeline, header);
}

// ---------------------------------------------------------------------------
// Flat structure → SELECT / FROM / JOIN / WHERE
// ---------------------------------------------------------------------------

function renderFlat(pipeline: EntityPipelineWithColumns, header: string): string {
  const lines: string[] = [header];

  // SELECT
  lines.push("SELECT");
  const colLines = pipeline.columns.map((col, i) => {
    const sql = renderColumn(col);
    const comma = i < pipeline.columns.length - 1 ? "," : "";
    return `  ${sql}${comma}`;
  });
  lines.push(...colLines);

  // FROM (first source)
  const primary = pipeline.sources[0];
  if (primary) {
    lines.push(`FROM ${asString(primary.table, primary.alias)} ${asString(primary.alias, "t0")}`);
  }

  // JOINs
  if (pipeline.joins?.length) {
    for (const join of pipeline.joins) {
      lines.push(renderJoin(join, pipeline.sources));
    }
  }

  // WHERE (from source filters)
  const whereClauses = collectFilters(pipeline.sources);
  if (whereClauses.length) {
    lines.push(`WHERE ${whereClauses.join("\n  AND ")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Assembly structure → CTEs + UNION ALL
// ---------------------------------------------------------------------------

function renderAssembly(pipeline: EntityPipelineWithColumns, header: string): string {
  const concatSources = pipeline.concat?.sources ?? [];
  const lines: string[] = [
    `${header} | UNION ALL [${concatSources.join(", ")}]`,
  ];

  // Each concat source becomes a CTE
  const cteBlocks: string[] = [];
  for (const alias of concatSources) {
    const source = pipeline.sources.find((s) => s.alias === alias);
    if (!source) continue;

    const cteLines: string[] = [`${alias} AS (`];
    cteLines.push("  SELECT");

    const colLines = pipeline.columns.map((col, i) => {
      const sql = renderColumn(col, alias);
      const comma = i < pipeline.columns.length - 1 ? "," : "";
      return `    ${sql}${comma}`;
    });
    cteLines.push(...colLines);
    cteLines.push(`  FROM ${asString(source.table, alias)} ${alias}`);

    // Filters for this source
    const filters = collectFilters([source]);
    if (filters.length) {
      cteLines.push(`  WHERE ${filters.join("\n    AND ")}`);
    }

    cteLines.push(")");
    cteBlocks.push(cteLines.join("\n"));
  }

  if (cteBlocks.length) {
    lines.push(`WITH ${cteBlocks[0]}`);
    for (let i = 1; i < cteBlocks.length; i++) {
      lines.push(`, ${cteBlocks[i]}`);
    }
  }

  // Final UNION ALL
  lines.push(
    concatSources
      .map((alias, i) => (i === 0 ? `SELECT * FROM ${alias}` : `UNION ALL\nSELECT * FROM ${alias}`))
      .join("\n")
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Column rendering
// ---------------------------------------------------------------------------

function renderColumn(col: PipelineColumn, _ctxAlias?: string): string {
  const target = col.target_column;

  // Null / unmapped
  if (col.transform === "null" || (Array.isArray(col.source) && col.source.length === 0)) {
    return `NULL AS ${target}`;
  }

  // Hash ID
  if (col.transform === "hash_id" && col.hash_columns?.length) {
    const parts = col.hash_columns.map((c) => {
      // Bare names (no dot) are entity-name literals for collision avoidance — quote them
      if (!c.includes(".")) return `'${c}'`;
      return `CAST(${c} AS STRING)`;
    });
    return `TO_HEX(MD5(CONCAT(${parts.join(", '|', ")}))) AS ${target}`;
  }

  // Literal
  if (col.source && typeof col.source === "object" && !Array.isArray(col.source) && "literal" in col.source) {
    const val = (col.source as Record<string, unknown>).literal;
    if (typeof val === "string") return `'${val}' AS ${target}`;
    if (typeof val === "boolean") return `${String(val).toUpperCase()} AS ${target}`;
    return `${val} AS ${target}`;
  }

  // Expression
  if (col.transform === "expression" && col.expression) {
    const sql = pandasToSql(col.expression);
    return `${sql} AS ${target}`;
  }

  // Identity (bare source reference)
  if (typeof col.source === "string") {
    return col.source === target ? col.source : `${col.source} AS ${target}`;
  }

  // Fallback
  return `NULL AS ${target}`;
}

// ---------------------------------------------------------------------------
// Join rendering
// ---------------------------------------------------------------------------

function renderJoin(join: PipelineJoin, sources: PipelineSource[]): string {
  const joinType = asString(join.how, "left").toUpperCase();
  const rightAlias = asString(join.right);
  const rightSource = sources.find((s) => s.alias === rightAlias);
  const tableName = rightSource ? asString(rightSource.table, rightAlias) : rightAlias;

  const onClauses = (Array.isArray(join.on) ? join.on : []).map((clause) => {
    const normalized = typeof clause === "string" ? clause.replace(/==/g, "=") : String(clause);
    // CAST both sides of equality joins to STRING to prevent INT64 vs STRING mismatches
    return normalized.replace(
      /(\w+(?:\.\w+)+)\s*=\s*(\w+(?:\.\w+)+)/g,
      "CAST($1 AS STRING) = CAST($2 AS STRING)"
    );
  });
  return `${joinType} JOIN ${tableName} ${rightAlias} ON ${onClauses.join(" AND ")}`;
}

// ---------------------------------------------------------------------------
// Filter rendering
// ---------------------------------------------------------------------------

function collectFilters(sources: PipelineSource[]): string[] {
  const clauses: string[] = [];
  for (const src of sources) {
    if (!src.filters) continue;
    for (const filter of src.filters) {
      clauses.push(renderFilter(filter, src.alias));
    }
  }
  return clauses;
}

function renderFilter(filter: Record<string, unknown>, alias: string): string {
  const col = filter.column as string | undefined;
  const op = filter.operator as string | undefined;
  const val = filter.value;
  const field = col ? `${alias}.${col}` : alias;

  // CAST both sides to STRING to prevent INT64 vs STRING mismatches
  // (mirrors the same pattern used in renderJoin)
  switch (op) {
    case "eq":
      return `CAST(${field} AS STRING) = CAST(${filterLiteral(val)} AS STRING)`;
    case "not_eq":
      return `CAST(${field} AS STRING) != CAST(${filterLiteral(val)} AS STRING)`;
    case "in":
      if (Array.isArray(val)) return `CAST(${field} AS STRING) IN (${val.map((v) => `CAST(${filterLiteral(v)} AS STRING)`).join(", ")})`;
      return `${field} IN (${val})`;
    case "not_in":
      if (Array.isArray(val)) return `CAST(${field} AS STRING) NOT IN (${val.map((v) => `CAST(${filterLiteral(v)} AS STRING)`).join(", ")})`;
      return `${field} NOT IN (${val})`;
    case "is_not_null":
      return `${field} IS NOT NULL`;
    case "is_null":
      return `${field} IS NULL`;
    case "expression":
      return typeof val === "string" ? val : String(val);
    default:
      // Best-effort: just render key=value
      if (col && val !== undefined) return `CAST(${field} AS STRING) = CAST(${filterLiteral(val)} AS STRING)`;
      return `/* unknown filter: ${JSON.stringify(filter)} */`;
  }
}

/** Quote a filter value appropriately — numbers stay bare, strings get quoted */
function filterLiteral(val: unknown): string {
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  const s = String(val);
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return `'${s}'`;
}

// ---------------------------------------------------------------------------
// Pandas → BigQuery SQL converter (bracket-aware recursive)
// ---------------------------------------------------------------------------

interface PeeledCall {
  subject: string;
  method: string;
  args: string;
}

/**
 * Peel the outermost method call from a chained expression.
 * Scans backwards from trailing `)` to find the matching `(`,
 * then finds the last `.` at depth 0 to split subject.method(args).
 * Folds `.str.X` into compound method names (e.g. "str.upper").
 */
function peelOuterCall(expr: string): PeeledCall | null {
  const s = expr.trim();
  if (!s.endsWith(")")) return null;

  // Walk backwards to find the matching '('
  let depth = 0;
  let parenStart = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch === ")" || ch === "]" || ch === "}") depth++;
    else if (ch === "(" || ch === "[" || ch === "{") {
      depth--;
      if (depth === 0) {
        parenStart = i;
        break;
      }
    }
  }
  if (parenStart <= 0) return null;

  const args = s.slice(parenStart + 1, s.length - 1).trim();
  const prefix = s.slice(0, parenStart); // everything before '('

  // Find the last '.' at bracket-depth 0 in prefix to split subject.method
  let dotPos = -1;
  depth = 0;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const ch = prefix[i];
    if (ch === ")" || ch === "]" || ch === "}") depth++;
    else if (ch === "(" || ch === "[" || ch === "{") depth--;
    if (ch === "." && depth === 0) {
      dotPos = i;
      break;
    }
  }
  if (dotPos < 0) return null;

  let subject = prefix.slice(0, dotPos);
  let method = prefix.slice(dotPos + 1);

  // Fold .str.X → compound method "str.X" (peel one more dot)
  if (subject.endsWith(".str")) {
    subject = subject.slice(0, -4);
    method = `str.${method}`;
  }

  return { subject, method, args };
}

/**
 * Render a peeled method call to BigQuery SQL.
 * Recurses into pandasToSql for the subject.
 */
function renderMethod(call: PeeledCall): string | null {
  const inner = pandasToSql(call.subject);
  const { method, args } = call;

  // .str.* methods require STRING input — cast to avoid INT64/FLOAT64 mismatches
  const strInner = method.startsWith("str.") ? `CAST(${inner} AS STRING)` : inner;

  switch (method) {
    case "fillna": {
      const val = convertValue(args);
      return `COALESCE(${inner}, ${val})`;
    }
    case "map": {
      // args should be {key: val, ...}
      const braceMatch = args.match(/^\{([\s\S]*)\}$/);
      if (braceMatch) return renderMap(call.subject, braceMatch[1]);
      return null;
    }
    case "eq": {
      const val = args.replace(/^["']|["']$/g, "");
      return `${inner} = '${val}'`;
    }
    case "isin": {
      const listMatch = args.match(/^\[([\s\S]*)\]$/);
      if (listMatch) {
        const vals = splitTopLevel(listMatch[1]).map((v) => {
          const t = v.trim().replace(/^["']|["']$/g, "");
          return `'${t}'`;
        });
        return `${inner} IN (${vals.join(", ")})`;
      }
      return null;
    }
    case "notna":
      return `${inner} IS NOT NULL`;
    case "isna":
      return `${inner} IS NULL`;
    case "str.upper":
      return `UPPER(${strInner})`;
    case "str.lower":
      return `LOWER(${strInner})`;
    case "str.strip":
      return `TRIM(${strInner})`;
    case "str.replace": {
      const parts = splitTopLevel(args);
      if (parts.length >= 2) {
        const a = parts[0].trim().replace(/^["']|["']$/g, "");
        const b = parts[1].trim().replace(/^["']|["']$/g, "");
        // Check for regex=True
        const hasRegex = parts.some((p) => /regex\s*=\s*True/.test(p));
        if (hasRegex) return `REGEXP_REPLACE(${strInner}, r'${a}', '${b}')`;
        return `REPLACE(${strInner}, '${a}', '${b}')`;
      }
      return null;
    }
    case "str.contains": {
      const pattern = args.replace(/^["']|["']$/g, "");
      return `${strInner} LIKE '%${pattern}%'`;
    }
    case "str.len":
      return `LENGTH(${strInner})`;
    case "astype": {
      const t = args.replace(/^["']|["']$/g, "").toLowerCase();
      if (t === "int" || t === "int64") return `CAST(${inner} AS INT64)`;
      if (t === "float" || t === "float64") return `CAST(${inner} AS FLOAT64)`;
      if (t === "str" || t === "string") return `CAST(${inner} AS STRING)`;
      if (t === "bool" || t === "boolean") return `CAST(${inner} AS BOOL)`;
      return `CAST(${inner} AS ${t.toUpperCase()})`;
    }
    case "round": {
      const n = args.trim() || "0";
      return `ROUND(${inner}, ${n})`;
    }
    case "where": {
      const parts = splitTopLevel(args);
      if (parts.length >= 2) {
        const cond = pandasToSql(parts[0].trim());
        const other = convertValue(parts[1].trim());
        return `IF(${cond}, ${inner}, ${other})`;
      }
      return null;
    }
    case "abs":
      return `ABS(${inner})`;
    default:
      return null;
  }
}

/**
 * Match top-level function calls: np.select, np.where, pd.to_datetime, pd.to_numeric
 */
function matchTopLevelFunction(expr: string): string | null {
  // np.select(conditions, values, default)
  const selectMatch = expr.match(/^np\.select\(\s*\[([\s\S]+)\]\s*,\s*\[([\s\S]+)\]\s*(?:,\s*([\s\S]+))?\s*\)$/);
  if (selectMatch) {
    return renderNpSelect(selectMatch[1], selectMatch[2], selectMatch[3]);
  }

  // np.where(cond, true_val, false_val) — bracket-aware split
  const npWhereMatch = expr.match(/^np\.where\(([\s\S]+)\)$/);
  if (npWhereMatch) {
    const parts = splitTopLevel(npWhereMatch[1]);
    if (parts.length >= 3) {
      const cond = pandasToSql(parts[0].trim());
      const t = convertValue(parts[1].trim());
      const f = convertValue(parts[2].trim());
      return `IF(${cond}, ${t}, ${f})`;
    }
  }

  // pd.to_datetime(x)
  const dtMatch = expr.match(/^pd\.to_datetime\((.+?)\)$/);
  if (dtMatch) {
    return `CAST(${dtMatch[1].trim()} AS TIMESTAMP)`;
  }

  // pd.to_numeric(x, errors="coerce") → SAFE_CAST
  const numMatch = expr.match(/^pd\.to_numeric\(([\s\S]+)\)$/);
  if (numMatch) {
    const parts = splitTopLevel(numMatch[1]);
    const subject = parts[0].trim();
    const hasCoerce = parts.some((p) => /errors\s*=\s*["']coerce["']/.test(p));
    if (hasCoerce) return `SAFE_CAST(${subject} AS FLOAT64)`;
    return `CAST(${subject} AS FLOAT64)`;
  }

  return null;
}

/**
 * Render string slicing: expr.str[-4:] → RIGHT(x, 4), expr.str[2:5] → SUBSTR(x, 3, 3)
 */
function renderSlice(expr: string): string | null {
  const sliceMatch = expr.match(/^(.+?)\.str\[(-?\d*):(-?\d*)?\]$/);
  if (!sliceMatch) return null;

  // .str[] slicing requires STRING — cast to avoid INT64/FLOAT64 mismatches
  const subject = `CAST(${pandasToSql(sliceMatch[1])} AS STRING)`;
  const startStr = sliceMatch[2];
  const endStr = sliceMatch[3];

  if (startStr.startsWith("-") && !endStr) {
    // str[-4:] → RIGHT(x, 4)
    return `RIGHT(${subject}, ${startStr.slice(1)})`;
  }
  if (startStr && endStr) {
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    // str[2:5] → SUBSTR(x, 3, 3)  (Python 0-based → SQL 1-based)
    return `SUBSTR(${subject}, ${start + 1}, ${end - start})`;
  }
  if (!startStr && endStr) {
    // str[:5] → LEFT(x, 5)
    return `LEFT(${subject}, ${endStr})`;
  }

  return null;
}

export function pandasToSql(expr: string): string {
  // Normalize: collapse multi-line to single space
  const sql = expr.trim().replace(/\n\s*/g, " ");

  // 1. Top-level functions: np.select, np.where, pd.to_datetime, pd.to_numeric
  const topLevel = matchTopLevelFunction(sql);
  if (topLevel) return topLevel;

  // 2. Bracket-aware method peeling (handles chained calls)
  const peeled = peelOuterCall(sql);
  if (peeled) {
    const result = renderMethod(peeled);
    if (result) return result;
  }

  // 3. String slicing: expr.str[-4:]
  const sliced = renderSlice(sql);
  if (sliced) return sliced;

  // 4. Fallback: if it still looks like pandas, annotate
  if (/\.(map|eq|isin|fillna|astype|notna|isna|str[.[])/.test(sql) || /^(np|pd)\./.test(sql)) {
    return `/* pandas: ${sql} */ NULL`;
  }

  // 5. Bare reference or already-SQL — passthrough
  return sql;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNpSelect(conditionsStr: string, valuesStr: string, defaultStr?: string): string {
  const conditions = splitTopLevel(conditionsStr);
  const values = splitTopLevel(valuesStr);
  const lines: string[] = ["CASE"];

  for (let i = 0; i < conditions.length && i < values.length; i++) {
    const cond = pandasToSql(conditions[i].trim());
    const val = convertValue(values[i].trim());
    lines.push(`  WHEN ${cond} THEN ${val}`);
  }

  if (defaultStr) {
    const def = convertValue(defaultStr.trim());
    lines.push(`  ELSE ${def}`);
  }

  lines.push("END");
  return lines.join("\n");
}

function renderMap(subject: string, entriesStr: string): string {
  const inner = pandasToSql(subject);
  const lines: string[] = ["CASE"];
  // Parse key: value pairs — handles quoted keys, numeric keys, and various value types
  const entryRegex = /["']?([^"',:\s]+)["']?\s*:\s*([^,}]+)/g;
  let match;
  while ((match = entryRegex.exec(entriesStr)) !== null) {
    const key = match[1].trim();
    const val = convertValue(match[2].trim());
    // Numeric keys don't get quoted
    if (/^-?\d+(\.\d+)?$/.test(key)) {
      lines.push(`  WHEN ${inner} = ${key} THEN ${val}`);
    } else {
      lines.push(`  WHEN ${inner} = '${key}' THEN ${val}`);
    }
  }
  lines.push("END");
  return lines.join("\n");
}

/** Split a string on commas that are not inside brackets or parens */
function splitTopLevel(str: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of str) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// BQ-qualified renderers (for executing against BigQuery)
// ---------------------------------------------------------------------------

export interface BqSqlConfig {
  projectId: string;
  sourceDataset: string;
}

/**
 * Renders executable SQL for a flat pipeline, qualifying bare table names
 * with `project.dataset.Table` using the pipeline's sources array.
 */
export function renderExecutableSql(
  pipeline: EntityPipelineWithColumns,
  bqConfig: BqSqlConfig,
  limit?: number
): string {
  const raw = renderPipelineSql(pipeline);
  let sql = qualifyTableNames(raw, pipeline.sources, bqConfig);
  if (limit && !/\bLIMIT\s+\d+/i.test(sql)) {
    sql = `${sql.replace(/;?\s*$/, "")}\nLIMIT ${limit}`;
  }
  return sql;
}

/**
 * For assembly entities, renders a single component's SELECT with qualified
 * table names and an optional LIMIT. Used to query each component separately.
 */
export function renderComponentSql(
  pipeline: EntityPipelineWithColumns,
  componentAlias: string,
  bqConfig: BqSqlConfig,
  limit?: number
): string {
  const source = pipeline.sources.find((s) => s.alias === componentAlias);
  if (!source) throw new Error(`Component alias "${componentAlias}" not found in pipeline sources`);

  const qualifiedTable = qualifyTable(asString(source.table, componentAlias), bqConfig);

  const lines: string[] = [];
  lines.push("SELECT");

  const filteredCols = pipeline.columns.filter((c) => c.transform !== "null");
  filteredCols.forEach((col, i) => {
    const sql = renderColumn(col, componentAlias);
    const comma = i < filteredCols.length - 1 ? "," : "";
    lines.push(`  ${sql}${comma}`);
  });

  lines.push(`FROM ${qualifiedTable} ${componentAlias}`);

  const filters = collectFilters([source]);
  if (filters.length) {
    lines.push(`WHERE ${filters.join("\n  AND ")}`);
  }

  if (limit) {
    lines.push(`LIMIT ${limit}`);
  }

  return lines.join("\n");
}

function qualifyTable(bareTable: string, bqConfig: BqSqlConfig): string {
  // If already qualified (contains a dot or backtick), leave as-is
  if (bareTable.includes(".") || bareTable.includes("`")) return bareTable;
  return `\`${bqConfig.projectId}.${bqConfig.sourceDataset}.${bareTable}\``;
}

function qualifyTableNames(
  sql: string,
  sources: PipelineSource[],
  bqConfig: BqSqlConfig
): string {
  let result = sql;
  for (const source of sources) {
    const bare = asString(source.table);
    if (!bare || bare.includes(".") || bare.includes("`")) continue;
    const qualified = `\`${bqConfig.projectId}.${bqConfig.sourceDataset}.${bare}\``;
    // Replace "FROM TableName alias" and "JOIN TableName alias" patterns
    const pattern = new RegExp(`(FROM|JOIN)\\s+${escapeRegex(bare)}\\b`, "g");
    result = result.replace(pattern, `$1 ${qualified}`);
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse BQ "Name X not found inside Y" errors and return the bad source refs.
 * Returns e.g. ["li.MtgrGenerationalSuffixCode"] or [] if no match.
 */
export function parseBadColumnRefs(errorMessage: string): string[] {
  const refs: string[] = [];
  const re = /Name\s+(\w+)\s+not found inside\s+(\w+)/gi;
  let m;
  while ((m = re.exec(errorMessage)) !== null) {
    refs.push(`${m[2]}.${m[1]}`);
  }
  return refs;
}

/**
 * Return a new pipeline with columns referencing any of `badRefs` nullified.
 * badRefs are like ["li.MtgrGenerationalSuffixCode"].
 */
export function nullifyBadColumns(
  pipeline: EntityPipelineWithColumns,
  badRefs: string[]
): { pipeline: EntityPipelineWithColumns; nullified: string[] } {
  const badSet = new Set(badRefs.map((r) => r.toLowerCase()));
  const nullified: string[] = [];

  const columns = pipeline.columns.map((col) => {
    // Check if source, expression, or hash_columns reference a bad ref
    const refs = collectColumnRefs(col);
    const hasBad = refs.some((r) => badSet.has(r.toLowerCase()));
    if (hasBad) {
      nullified.push(col.target_column);
      return { ...col, transform: "null" as const, source: [], expression: undefined, hash_columns: undefined };
    }
    return col;
  });

  return { pipeline: { ...pipeline, columns }, nullified };
}

/** Collect all alias.column references from a pipeline column */
function collectColumnRefs(col: PipelineColumn): string[] {
  const refs: string[] = [];
  // Identity source
  if (typeof col.source === "string" && col.source.includes(".")) {
    refs.push(col.source);
  }
  // Expression — extract alias.column patterns
  if (col.expression) {
    const re = /\b(\w+\.\w+)\b/g;
    let m;
    while ((m = re.exec(col.expression)) !== null) {
      // Skip np.xxx, pd.xxx patterns
      if (!/^(np|pd)\./.test(m[1])) refs.push(m[1]);
    }
  }
  // Hash columns
  if (col.hash_columns) {
    for (const hc of col.hash_columns) {
      if (hc.includes(".")) refs.push(hc);
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a Python value to SQL literal */
function convertValue(val: string): string {
  const v = val.trim();
  // Python None / pd.NA / np.nan → NULL
  if (/^(None|pd\.NA|np\.nan|NaN)$/i.test(v)) return "NULL";
  // Python True/False
  if (v === "True" || v === "true") return "TRUE";
  if (v === "False" || v === "false") return "FALSE";
  // Already quoted string
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return `'${v.slice(1, -1)}'`;
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  // Bare reference or expression — passthrough
  return v;
}
