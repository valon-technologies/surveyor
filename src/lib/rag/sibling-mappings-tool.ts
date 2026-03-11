import type { ToolDefinition } from "@/lib/llm/provider";
import { db } from "@/lib/db";
import { field, fieldMapping, entity } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────

export interface SiblingMappingsInput {
  filter:
    | "all_summary"
    | "mapped_with_transforms"
    | "by_source_table"
    | "by_data_type"
    | "by_name";
  searchTerm?: string;
  limit?: number;
}

interface SiblingRow {
  fieldName: string;
  dataType: string | null;
  status: string;
  confidence: string | null;
  mappingType: string | null;
  sourceTable: string | null;
  sourceField: string | null;
  transform: string | null;
  reasoning: string | null;
}

export interface SiblingMappingsResult {
  success: boolean;
  filter: string;
  siblings: SiblingRow[];
  totalSiblings: number;
  error?: string;
}

// ─── Definition ────────────────────────────────────────────────

export function getSiblingMappingsToolDefinition(): ToolDefinition {
  return {
    name: "get_sibling_mappings",
    description:
      "Look up how other fields in this entity are mapped. Use this to understand " +
      "established patterns — which source tables siblings map from, what transforms " +
      "they use, and what structural approach is used across the entity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          enum: [
            "all_summary",
            "mapped_with_transforms",
            "by_source_table",
            "by_data_type",
            "by_name",
          ],
          description:
            "View mode: " +
            "'all_summary' = compact one-liner per sibling, " +
            "'mapped_with_transforms' = detailed view of siblings with transforms, " +
            "'by_source_table' = group by source table, " +
            "'by_data_type' = filter by data type (use searchTerm), " +
            "'by_name' = search siblings by name (use searchTerm)",
        },
        searchTerm: {
          type: "string",
          description:
            "Required for by_data_type (e.g. 'DATE', 'BOOLEAN') and by_name (e.g. 'loan'). " +
            "Optional for by_source_table to filter to a specific table.",
        },
        limit: {
          type: "number",
          description: "Max results (default 30, max 60)",
        },
      },
      required: ["filter"],
    },
  };
}

// ─── Executor ──────────────────────────────────────────────────

export async function executeSiblingMappingLookup(
  input: SiblingMappingsInput,
  workspaceId: string,
  entityId: string,
  targetFieldId: string,
  transferId?: string | null
): Promise<SiblingMappingsResult> {
  const { filter, searchTerm, limit: rawLimit } = input;
  const maxResults = Math.min(rawLimit || 30, 60);

  // Load all sibling fields (exclude current target field)
  const siblingFields = (await db
    .select()
    .from(field)
    .where(eq(field.entityId, entityId))
    .orderBy(field.sortOrder)
    )
    .filter((f) => f.id !== targetFieldId);

  // Load latest mappings — scoped to same transfer when in transfer context
  const mappingConditions = [eq(fieldMapping.workspaceId, workspaceId), eq(fieldMapping.isLatest, true)];
  if (transferId) {
    mappingConditions.push(eq(fieldMapping.transferId, transferId));
  }
  const latestMappings = await db
    .select()
    .from(fieldMapping)
    .where(and(...mappingConditions))
    ;

  // Load source entities for name resolution
  const sourceEntities = await db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    ;

  const entityMap = new Map(sourceEntities.map((e) => [e.id, e.displayName || e.name]));

  // Build sibling rows with mapping info
  const rows: SiblingRow[] = await Promise.all(siblingFields.map(async (sf) => {
    const m = latestMappings.find((lm) => lm.targetFieldId === sf.id);
    let sourceTable: string | null = null;
    let sourceField: string | null = null;

    if (m?.sourceEntityId) {
      sourceTable = entityMap.get(m.sourceEntityId) || null;
    }
    if (m?.sourceFieldId) {
      const sfld = (await db
        .select({ name: field.name })
        .from(field)
        .where(eq(field.id, m.sourceFieldId))
        )[0];
      sourceField = sfld?.name || null;
    }

    return {
      fieldName: sf.displayName || sf.name,
      dataType: sf.dataType,
      status: m?.status || "unmapped",
      confidence: m?.confidence || null,
      mappingType: m?.mappingType || null,
      sourceTable,
      sourceField,
      transform: m?.transform || null,
      reasoning: m?.reasoning || null,
    };
  }));

  // Apply filter
  let filtered: SiblingRow[];

  switch (filter) {
    case "all_summary":
      filtered = rows;
      break;

    case "mapped_with_transforms":
      filtered = rows.filter(
        (r) =>
          r.transform &&
          r.status !== "unmapped" &&
          (r.confidence === "high" || r.confidence === "medium")
      );
      break;

    case "by_source_table": {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = rows.filter(
          (r) => r.sourceTable && r.sourceTable.toLowerCase().includes(term)
        );
      } else {
        // Return all mapped, grouped later in formatting
        filtered = rows.filter((r) => r.sourceTable);
      }
      break;
    }

    case "by_data_type": {
      if (!searchTerm) {
        return {
          success: false,
          filter,
          siblings: [],
          totalSiblings: rows.length,
          error: "searchTerm is required for by_data_type filter (e.g. 'DATE', 'BOOLEAN')",
        };
      }
      const dt = searchTerm.toUpperCase();
      filtered = rows.filter((r) => r.dataType?.toUpperCase() === dt);
      break;
    }

    case "by_name": {
      if (!searchTerm) {
        return {
          success: false,
          filter,
          siblings: [],
          totalSiblings: rows.length,
          error: "searchTerm is required for by_name filter",
        };
      }
      const term = searchTerm.toLowerCase();
      filtered = rows.filter((r) => r.fieldName.toLowerCase().includes(term));
      break;
    }

    default:
      filtered = rows;
  }

  return {
    success: true,
    filter,
    siblings: filtered.slice(0, maxResults),
    totalSiblings: rows.length,
  };
}

// ─── Formatters ────────────────────────────────────────────────

export function formatSiblingMappingsForLLM(result: SiblingMappingsResult): string {
  if (!result.success) {
    return `Sibling lookup failed: ${result.error}`;
  }

  if (result.siblings.length === 0) {
    return `No sibling fields matched filter "${result.filter}". ${result.totalSiblings} total siblings in entity.`;
  }

  const parts: string[] = [];
  parts.push(
    `${result.siblings.length} sibling(s) shown (${result.totalSiblings} total in entity):\n`
  );

  if (result.filter === "all_summary") {
    // Compact one-liner format
    for (const s of result.siblings) {
      const source = s.sourceTable
        ? `← ${s.sourceTable}${s.sourceField ? "." + s.sourceField : ""}`
        : "";
      const dtype = s.dataType ? ` (${s.dataType})` : "";
      const conf = s.confidence ? ` [${s.confidence}]` : "";
      parts.push(`- ${s.fieldName}${dtype} — ${s.status}${conf} ${source}`);
    }
  } else if (result.filter === "by_source_table") {
    // Group by source table
    const grouped = new Map<string, SiblingMappingsResult["siblings"]>();
    for (const s of result.siblings) {
      const table = s.sourceTable || "(unmapped)";
      if (!grouped.has(table)) grouped.set(table, []);
      grouped.get(table)!.push(s);
    }
    for (const [table, siblings] of grouped) {
      parts.push(`\n**${table}** (${siblings.length} fields):`);
      for (const s of siblings) {
        const xform = s.transform && s.transform !== "identity" ? ` | transform: ${s.transform}` : "";
        parts.push(`- ${s.fieldName} ← ${s.sourceField || "?"}${xform}`);
      }
    }
  } else {
    // Detailed format for mapped_with_transforms, by_data_type, by_name
    for (const s of result.siblings) {
      const dtype = s.dataType ? ` (${s.dataType})` : "";
      const source = s.sourceTable
        ? `← ${s.sourceTable}${s.sourceField ? "." + s.sourceField : ""}`
        : "";
      parts.push(`**${s.fieldName}**${dtype} — ${s.status} ${source}`);
      if (s.mappingType) parts.push(`  Type: ${s.mappingType}`);
      if (s.transform) parts.push(`  Transform: ${s.transform}`);
      if (s.reasoning) {
        const reason =
          s.reasoning.length > 150
            ? s.reasoning.slice(0, 150) + "..."
            : s.reasoning;
        parts.push(`  Reasoning: ${reason}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

export function formatSiblingMappingsForClient(result: SiblingMappingsResult): {
  toolName: string;
  filter: string;
  matchCount: number;
  totalSiblings: number;
  success: boolean;
  error?: string;
} {
  return {
    toolName: "get_sibling_mappings",
    filter: result.filter,
    matchCount: result.siblings.length,
    totalSiblings: result.totalSiblings,
    success: result.success,
    error: result.error,
  };
}
