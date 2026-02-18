import type {
  EntityPipelineWithColumns,
  PipelineColumn,
  PipelineJoin,
  PipelineSource,
} from "@/types/pipeline";

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
    lines.push(`FROM ${primary.table} ${primary.alias}`);
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
    cteLines.push(`  FROM ${source.table} ${alias}`);

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
    const parts = col.hash_columns.map((c) => `CAST(${c} AS STRING)`);
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
  const joinType = (join.how || "left").toUpperCase();
  const rightSource = sources.find((s) => s.alias === join.right);
  const tableName = rightSource?.table ?? join.right;
  const alias = join.right;

  const onClauses = join.on.map((clause) => clause.replace(/==/g, "="));
  return `${joinType} JOIN ${tableName} ${alias} ON ${onClauses.join(" AND ")}`;
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

  switch (op) {
    case "eq":
      return `${field} = '${val}'`;
    case "not_eq":
      return `${field} != '${val}'`;
    case "in":
      if (Array.isArray(val)) return `${field} IN (${val.map((v) => `'${v}'`).join(", ")})`;
      return `${field} IN (${val})`;
    case "not_in":
      if (Array.isArray(val)) return `${field} NOT IN (${val.map((v) => `'${v}'`).join(", ")})`;
      return `${field} NOT IN (${val})`;
    case "is_not_null":
      return `${field} IS NOT NULL`;
    case "is_null":
      return `${field} IS NULL`;
    case "expression":
      return typeof val === "string" ? val : String(val);
    default:
      // Best-effort: just render key=value
      if (col && val !== undefined) return `${field} = '${val}'`;
      return `/* unknown filter: ${JSON.stringify(filter)} */`;
  }
}

// ---------------------------------------------------------------------------
// Pandas → BigQuery SQL converter (best-effort regex)
// ---------------------------------------------------------------------------

export function pandasToSql(expr: string): string {
  let sql = expr.trim();

  // np.select(conditions, values, default) → CASE WHEN ... END
  const selectMatch = sql.match(/^np\.select\(\s*\[([\s\S]+)\]\s*,\s*\[([\s\S]+)\]\s*(?:,\s*([\s\S]+))?\s*\)$/);
  if (selectMatch) {
    return renderNpSelect(selectMatch[1], selectMatch[2], selectMatch[3]);
  }

  // np.where(cond, true_val, false_val) → IF(cond, true_val, false_val)
  const whereMatch = sql.match(/^np\.where\(\s*(.+?)\s*,\s*(.+?)\s*,\s*(.+?)\s*\)$/);
  if (whereMatch) {
    const cond = pandasToSql(whereMatch[1]);
    const t = convertValue(whereMatch[2]);
    const f = convertValue(whereMatch[3]);
    return `IF(${cond}, ${t}, ${f})`;
  }

  // pd.to_datetime(x) → CAST(x AS TIMESTAMP)
  sql = sql.replace(/pd\.to_datetime\((.+?)\)/g, "CAST($1 AS TIMESTAMP)");

  // .astype(int) / .astype(float) / .astype(str)
  sql = sql.replace(/(\w+(?:\.\w+)*?)\.astype\(\s*(?:int|"int"|'int')\s*\)/g, "CAST($1 AS INT64)");
  sql = sql.replace(/(\w+(?:\.\w+)*?)\.astype\(\s*(?:float|"float"|'float')\s*\)/g, "CAST($1 AS FLOAT64)");
  sql = sql.replace(/(\w+(?:\.\w+)*?)\.astype\(\s*(?:str|"str"|'str')\s*\)/g, "CAST($1 AS STRING)");

  // .fillna(val) → COALESCE(x, val)
  const fillnaMatch = sql.match(/^(.+?)\.fillna\(\s*(.+?)\s*\)$/);
  if (fillnaMatch) {
    const inner = pandasToSql(fillnaMatch[1]);
    const val = convertValue(fillnaMatch[2]);
    return `COALESCE(${inner}, ${val})`;
  }

  // .map({key: val, ...}) → CASE WHEN x = key THEN val ... END
  const mapMatch = sql.match(/^(.+?)\.map\(\s*\{([\s\S]+)\}\s*\)$/);
  if (mapMatch) {
    return renderMap(mapMatch[1], mapMatch[2]);
  }

  // .eq("val") → x = 'val'
  const eqMatch = sql.match(/^(.+?)\.eq\(\s*["'](.+?)["']\s*\)$/);
  if (eqMatch) {
    return `${eqMatch[1]} = '${eqMatch[2]}'`;
  }

  // .isin(["a","b"]) → x IN ('a', 'b')
  const isinMatch = sql.match(/^(.+?)\.isin\(\s*\[(.+?)\]\s*\)$/);
  if (isinMatch) {
    const vals = isinMatch[2]
      .split(",")
      .map((v) => v.trim().replace(/^["']|["']$/g, ""))
      .map((v) => `'${v}'`);
    return `${isinMatch[1]} IN (${vals.join(", ")})`;
  }

  // .str.strip() → TRIM(x)
  sql = sql.replace(/^(.+?)\.str\.strip\(\)$/, "TRIM($1)");

  // .str.upper() → UPPER(x)
  sql = sql.replace(/^(.+?)\.str\.upper\(\)$/, "UPPER($1)");

  // .str.lower() → LOWER(x)
  sql = sql.replace(/^(.+?)\.str\.lower\(\)$/, "LOWER($1)");

  // .str.replace(a, b) → REPLACE(x, a, b)
  const replaceMatch = sql.match(/^(.+?)\.str\.replace\(\s*["'](.+?)["']\s*,\s*["'](.+?)["']\s*\)$/);
  if (replaceMatch) {
    return `REPLACE(${replaceMatch[1]}, '${replaceMatch[2]}', '${replaceMatch[3]}')`;
  }

  // If nothing matched and it looks like it still has pandas patterns, fallback
  if (/\.(map|eq|isin|fillna|astype|str\.)/.test(sql) || /^(np|pd)\./.test(sql)) {
    return `/* pandas: ${expr.trim()} */ NULL`;
  }

  // Bare reference or already-SQL — passthrough
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
  const lines: string[] = ["CASE"];
  // Parse key: value pairs — handles quoted keys and various value types
  const entryRegex = /["']?([^"',:\s]+)["']?\s*:\s*([^,}]+)/g;
  let match;
  while ((match = entryRegex.exec(entriesStr)) !== null) {
    const key = match[1].trim();
    const val = convertValue(match[2].trim());
    lines.push(`  WHEN ${subject} = '${key}' THEN ${val}`);
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
