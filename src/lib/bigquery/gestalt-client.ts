import { execFile } from "child_process";
import { promisify } from "util";
import { BigQuery } from "@google-cloud/bigquery";

const execFileAsync = promisify(execFile);

async function gestaltInvoke<T = unknown>(
  integration: string,
  operation: string,
  params: Record<string, string> = {}
): Promise<T> {
  const args = ["invoke", integration, operation];
  for (const [k, v] of Object.entries(params)) {
    args.push("-p", `${k}=${v}`);
  }

  try {
    const { stdout } = await execFileAsync("gestalt", args, {
      timeout: 30_000,
      env: { ...process.env, GESTALT_API_KEY: process.env.GESTALT_API_KEY },
    });

    const json = JSON.parse(stdout);
    if (json.status !== "success") {
      throw new Error(`Gestalt ${integration}.${operation} error: ${JSON.stringify(json)}`);
    }
    return json.data as T;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stderr" in err) {
      const stderr = (err as { stderr: string }).stderr;
      if (stderr.includes("Not authenticated")) {
        throw new Error("Gestalt not authenticated. Run: gestalt auth");
      }
      throw new Error(`Gestalt ${integration}.${operation} failed: ${stderr.trim()}`);
    }
    throw err;
  }
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
    "bigquery", "list_datasets", { project_id: projectId }
  );
  return data.datasets.map((d) => d.datasetReference.datasetId);
}

export async function listTables(projectId: string, datasetId: string): Promise<string[]> {
  const data = await gestaltInvoke<{ tables: Array<{ tableReference: BqTableRef }> }>(
    "bigquery", "list_tables", { project_id: projectId, dataset_id: datasetId }
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
    { project_id: projectId, dataset_id: datasetId, table_id: tableId }
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
 * Catches nonexistent tables, nonexistent fields, type mismatches,
 * and syntax errors without executing the query.
 */
export async function dryRunQuery(
  projectId: string,
  sql: string,
): Promise<DryRunResult> {
  try {
    const bq = new BigQuery({ projectId });
    const [job] = await bq.createQueryJob({ query: sql, dryRun: true });
    const totalBytesProcessed = Number(
      job.metadata?.statistics?.totalBytesProcessed ?? 0,
    );
    return { valid: true, totalBytesProcessed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}

// ─── SQL Queries (via ADC / @google-cloud/bigquery) ──────────

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

/**
 * Run a read-only SQL query against BigQuery.
 * Uses Application Default Credentials (gcloud auth application-default login).
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

  const bq = new BigQuery({ projectId });
  const [rows] = await bq.query({ query: safeSql });

  return {
    rows: rows as Record<string, unknown>[],
    totalRows: rows.length,
    truncated: !hasLimit && rows.length >= maxRows,
  };
}
