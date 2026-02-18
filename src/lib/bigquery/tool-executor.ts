import type { ToolDefinition } from "@/lib/llm/provider";
import type { BigQueryConfig } from "@/types/workspace";
import { runQuery } from "./gestalt-client";

const MAX_ROWS = 25;

export interface BqToolInput {
  sql: string;
  purpose: string;
}

export interface BqToolResult {
  success: boolean;
  data?: Record<string, unknown>[];
  error?: string;
  sql: string;
  purpose: string;
  rowCount?: number;
  truncated?: boolean;
  durationMs: number;
}

/**
 * Returns the tool definition for `query_bigquery`, including the
 * project.dataset in the description so the LLM knows how to reference tables.
 */
export function getBigQueryToolDefinition(
  bqConfig: BigQueryConfig
): ToolDefinition {
  return {
    name: "query_bigquery",
    description: `Run a read-only SQL query against BigQuery. Tables are in \`${bqConfig.projectId}.${bqConfig.sourceDataset}\`. Only SELECT/WITH statements are allowed. Results are limited to ${MAX_ROWS} rows. Use this to look up actual source data values, check distinct values, verify nulls, compare fields, etc.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: `The SQL query to run. Always use fully-qualified table names: \`${bqConfig.projectId}.${bqConfig.sourceDataset}.TableName\``,
        },
        purpose: {
          type: "string",
          description:
            "Brief explanation of what this query is checking (shown to the user)",
        },
      },
      required: ["sql", "purpose"],
    },
  };
}

/**
 * Execute a BigQuery tool call with safety checks.
 */
export async function executeBigQueryTool(
  input: BqToolInput,
  bqConfig: BigQueryConfig
): Promise<BqToolResult> {
  const start = Date.now();
  const { sql, purpose } = input;

  // Read-only enforcement: only allow SELECT/WITH
  const normalized = sql.trim().replace(/^\/\*[\s\S]*?\*\/\s*/, ""); // strip leading block comments
  const firstKeyword = normalized.split(/\s/)[0]?.toUpperCase();
  if (firstKeyword !== "SELECT" && firstKeyword !== "WITH") {
    return {
      success: false,
      error: `Only SELECT/WITH queries are allowed. Got: ${firstKeyword}`,
      sql,
      purpose,
      durationMs: Date.now() - start,
    };
  }

  try {
    const result = await runQuery(bqConfig.projectId, sql, MAX_ROWS);
    return {
      success: true,
      data: result.rows,
      sql,
      purpose,
      rowCount: result.totalRows,
      truncated: result.truncated,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Query failed",
      sql,
      purpose,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Format a BQ tool result as a markdown string for the LLM's tool_result content.
 */
export function formatToolResultForLLM(result: BqToolResult): string {
  if (!result.success) {
    return `Query failed: ${result.error}\n\nSQL: ${result.sql}`;
  }

  const rows = result.data ?? [];
  if (rows.length === 0) {
    return `Query returned 0 rows.\n\nSQL: ${result.sql}`;
  }

  // Build markdown table
  const cols = Object.keys(rows[0]);
  const header = `| ${cols.join(" | ")} |`;
  const separator = `| ${cols.map(() => "---").join(" | ")} |`;
  const dataRows = rows.map((row) => {
    const vals = cols.map((c) => {
      const v = row[c];
      return v === null ? "NULL" : String(v);
    });
    return `| ${vals.join(" | ")} |`;
  });

  const parts = [header, separator, ...dataRows];
  if (result.truncated) {
    parts.push(`\n(Showing ${rows.length} of more rows — results were truncated)`);
  }

  return parts.join("\n");
}

/**
 * Format a BQ tool result as structured JSON for the SSE `tool_result` event.
 */
export function formatToolResultForClient(result: BqToolResult): {
  toolName: string;
  purpose: string;
  sql: string;
  success: boolean;
  rowCount?: number;
  truncated?: boolean;
  error?: string;
  durationMs: number;
  preview?: Record<string, unknown>[];
} {
  return {
    toolName: "query_bigquery",
    purpose: result.purpose,
    sql: result.sql,
    success: result.success,
    rowCount: result.rowCount,
    truncated: result.truncated,
    error: result.error,
    durationMs: result.durationMs,
    // Send first 10 rows to client for display; LLM gets the full set
    preview: result.data?.slice(0, 10),
  };
}
