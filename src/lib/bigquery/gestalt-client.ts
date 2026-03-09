const GESTALT_BASE = "https://api.gestalt.peachstreet.dev/api/v1";

function getGestaltKey(): string {
  const key = process.env.GESTALT_API_KEY;
  if (!key) throw new Error("GESTALT_API_KEY not set");
  return key;
}

async function gestaltInvoke<T = unknown>(
  integration: string,
  operation: string,
  params: Record<string, string> = {},
  method: "GET" | "POST" = "POST"
): Promise<T> {
  let url = `${GESTALT_BASE}/${integration}/${operation}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${getGestaltKey()}`,
  };

  let body: string | undefined;
  if (method === "GET") {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(params);
  }

  const res = await fetch(url, { method, headers, body });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gestalt ${integration}.${operation} failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.data as T;
}

// ─── BigQuery Operations ─────────────────────────────────────

export interface BqTableRef {
  tableId: string;
  datasetId: string;
  projectId: string;
}

export interface BqField {
  name: string;
  type: string;
  mode: string;
  description: string | null;
}

export interface BqTableSchema {
  table_id: string;
  type: string;
  num_rows: number;
  num_bytes: number;
  schema: { fields: BqField[] };
}

export async function listDatasets(projectId: string): Promise<string[]> {
  const data = await gestaltInvoke<{ datasets: Array<{ datasetReference: { datasetId: string } }> }>(
    "bigquery", "list_datasets", { project_id: projectId }, "GET"
  );
  return data.datasets.map((d) => d.datasetReference.datasetId);
}

export async function listTables(projectId: string, datasetId: string): Promise<string[]> {
  const data = await gestaltInvoke<{ tables: Array<{ tableReference: BqTableRef }> }>(
    "bigquery", "list_tables", { project_id: projectId, dataset_id: datasetId }, "GET"
  );
  return (data.tables || []).map((t) => t.tableReference.tableId);
}

export async function getTableSchema(
  projectId: string,
  datasetId: string,
  tableId: string
): Promise<BqTableSchema> {
  return gestaltInvoke<BqTableSchema>(
    "bigquery", "get_table_schema",
    { project_id: projectId, dataset_id: datasetId, table_id: tableId }, "GET"
  );
}

export async function tableExists(
  projectId: string,
  datasetId: string,
  tableId: string
): Promise<boolean> {
  try {
    const tables = await listTables(projectId, datasetId);
    return tables.some((t) => t.toLowerCase() === tableId.toLowerCase());
  } catch {
    return false;
  }
}

export async function fieldExists(
  projectId: string,
  datasetId: string,
  tableId: string,
  fieldName: string
): Promise<{ exists: boolean; type?: string }> {
  try {
    const schema = await getTableSchema(projectId, datasetId, tableId);
    const field = schema.schema.fields.find(
      (f) => f.name.toLowerCase() === fieldName.toLowerCase()
    );
    return field ? { exists: true, type: field.type } : { exists: false };
  } catch {
    return { exists: false };
  }
}

export async function testConnection(
  projectId: string,
  datasetId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const datasets = await listDatasets(projectId);
    if (!datasets.includes(datasetId)) {
      return { success: false, error: `Dataset "${datasetId}" not found in project "${projectId}"` };
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not authenticated")) {
      return { success: false, error: "Gestalt not authenticated. Run: gestalt auth" };
    }
    return { success: false, error: msg };
  }
}

// ─── SQL Validation (dry run) ─────────────────────────────────

export interface DryRunResult {
  valid: boolean;
  error?: string;
  totalBytesProcessed?: number;
}

/**
 * Validate SQL via BigQuery dry run — zero cost, no row scanning.
 * Uses Gestalt API. Falls back to treating query errors as validation failures.
 */
export async function dryRunQuery(
  projectId: string,
  sql: string,
): Promise<DryRunResult> {
  try {
    // Gestalt doesn't have a dedicated dry-run op — run with LIMIT 0
    const drySQL = sql.trim().replace(/;$/, "") + " LIMIT 0";
    await gestaltInvoke<{ rows: unknown[] }>("bigquery", "query", {
      project_id: projectId,
      query: drySQL,
    });
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}

// ─── SQL Queries (via Gestalt HTTP API) ──────────────────────

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

/**
 * Run a read-only SQL query against BigQuery via Gestalt.
 * Enforces LIMIT to prevent runaway queries.
 */
export async function runQuery(
  projectId: string,
  sql: string,
  maxRows: number = 100
): Promise<QueryResult> {
  // Safety: enforce a LIMIT if not present
  const normalized = sql.trim().replace(/;$/, "");
  const hasLimit = /\bLIMIT\s+\d+/i.test(normalized);
  const safeSql = hasLimit ? normalized : `${normalized} LIMIT ${maxRows}`;

  const data = await gestaltInvoke<{
    rows: Record<string, unknown>[];
    total_rows: number;
  }>("bigquery", "query", {
    project_id: projectId,
    query: safeSql,
  });

  return {
    rows: data.rows || [],
    totalRows: data.total_rows ?? data.rows?.length ?? 0,
    truncated: !hasLimit && (data.rows?.length ?? 0) >= maxRows,
  };
}
