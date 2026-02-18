import type { ToolDefinition } from "@/lib/llm/provider";
import { db } from "@/lib/db";
import { entity, field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────

export interface SourceSchemaInput {
  query: string;
  tableName?: string;
  dataType?: string;
  limit?: number;
}

interface ScoredField {
  tableName: string;
  fieldName: string;
  dataType: string | null;
  description: string | null;
  score: number;
}

export interface SourceSchemaResult {
  success: boolean;
  query: string;
  matches: ScoredField[];
  totalSourceTables: number;
  totalSourceFields: number;
  error?: string;
}

// ─── Definition ────────────────────────────────────────────────

export function getSourceSchemaToolDefinition(): ToolDefinition {
  return {
    name: "search_source_schema",
    description:
      "Search source tables and fields by keyword, table name, or data type. " +
      "Use this to find candidate source fields for mapping. Returns ranked matches " +
      "with table name, field name, data type, and description.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword(s) to match against field names, display names, and descriptions. " +
            "Examples: 'loan number', 'effective date', 'investor code'",
        },
        tableName: {
          type: "string",
          description:
            "Optional: filter to a specific source table name (case-insensitive substring match)",
        },
        dataType: {
          type: "string",
          description:
            "Optional: filter by data type (e.g. 'STRING', 'DATE', 'INTEGER', 'BOOLEAN')",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 20, max 50)",
        },
      },
      required: ["query"],
    },
  };
}

// ─── Executor ──────────────────────────────────────────────────

export function executeSourceSchemaSearch(
  input: SourceSchemaInput,
  workspaceId: string
): SourceSchemaResult {
  const { query, tableName, dataType, limit: rawLimit } = input;
  const maxResults = Math.min(rawLimit || 20, 50);
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(Boolean);

  // Load all source entities + fields
  const sourceEntities = db
    .select({
      id: entity.id,
      name: entity.name,
      displayName: entity.displayName,
    })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();

  if (sourceEntities.length === 0) {
    return {
      success: true,
      query,
      matches: [],
      totalSourceTables: 0,
      totalSourceFields: 0,
    };
  }

  // Optional table name filter
  const filteredEntities = tableName
    ? sourceEntities.filter((e) =>
        (e.displayName || e.name).toLowerCase().includes(tableName.toLowerCase())
      )
    : sourceEntities;

  const scored: ScoredField[] = [];
  let totalFieldCount = 0;

  for (const se of filteredEntities) {
    const fields = db
      .select({
        name: field.name,
        displayName: field.displayName,
        dataType: field.dataType,
        description: field.description,
      })
      .from(field)
      .where(eq(field.entityId, se.id))
      .all();

    totalFieldCount += fields.length;

    for (const f of fields) {
      // Optional data type filter
      if (dataType && f.dataType?.toUpperCase() !== dataType.toUpperCase()) {
        continue;
      }

      const fName = (f.displayName || f.name).toLowerCase();
      const fNameNormalized = fName.replace(/[_\s-]/g, "");
      const queryNormalized = queryLower.replace(/[_\s-]/g, "");
      const fDesc = (f.description || "").toLowerCase();

      let score = 0;

      // Exact name match (normalized)
      if (fNameNormalized === queryNormalized) {
        score = 10;
      }
      // Prefix match
      else if (fNameNormalized.startsWith(queryNormalized)) {
        score = 7;
      }
      // All query tokens appear in name
      else if (queryTokens.every((t) => fNameNormalized.includes(t.replace(/[_\s-]/g, "")))) {
        score = 6;
      }
      // Substring match in name
      else if (fNameNormalized.includes(queryNormalized)) {
        score = 5;
      }
      // Any token in name
      else if (queryTokens.some((t) => fNameNormalized.includes(t.replace(/[_\s-]/g, "")))) {
        score = 4;
      }
      // Description match (all tokens)
      else if (queryTokens.every((t) => fDesc.includes(t))) {
        score = 3;
      }
      // Description match (any token)
      else if (queryTokens.some((t) => fDesc.includes(t))) {
        score = 2;
      }

      if (score > 0) {
        scored.push({
          tableName: se.displayName || se.name,
          fieldName: f.displayName || f.name,
          dataType: f.dataType,
          description: f.description,
          score,
        });
      }
    }
  }

  // Sort by score desc, then alphabetically
  scored.sort((a, b) => b.score - a.score || a.fieldName.localeCompare(b.fieldName));

  return {
    success: true,
    query,
    matches: scored.slice(0, maxResults),
    totalSourceTables: sourceEntities.length,
    totalSourceFields: totalFieldCount,
  };
}

// ─── Formatters ────────────────────────────────────────────────

export function formatSourceSchemaForLLM(result: SourceSchemaResult): string {
  if (!result.success) {
    return `Search failed: ${result.error}`;
  }

  if (result.matches.length === 0) {
    return `No source fields matched "${result.query}". Try broader keywords or search by table name.`;
  }

  const header = `Found ${result.matches.length} matching field(s) for "${result.query}":\n`;
  const tableHeader = "| Table | Field | DataType | Description |";
  const separator = "| --- | --- | --- | --- |";
  const rows = result.matches.map((m) => {
    const desc = m.description
      ? m.description.length > 80
        ? m.description.slice(0, 80) + "..."
        : m.description
      : "";
    return `| ${m.tableName} | ${m.fieldName} | ${m.dataType || ""} | ${desc} |`;
  });

  return [header, tableHeader, separator, ...rows].join("\n");
}

export function formatSourceSchemaForClient(result: SourceSchemaResult): {
  toolName: string;
  query: string;
  matchCount: number;
  success: boolean;
  error?: string;
} {
  return {
    toolName: "search_source_schema",
    query: result.query,
    matchCount: result.matches.length,
    success: result.success,
    error: result.error,
  };
}
