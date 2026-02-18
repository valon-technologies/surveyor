import type { ToolDefinition } from "@/lib/llm/provider";
import { db } from "@/lib/db";
import { field, fieldMapping, entity } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────

export interface MappingExamplesInput {
  fieldType: string;
  mappingType?: string;
  keyword?: string;
  limit?: number;
}

interface ExampleRow {
  entityName: string;
  fieldName: string;
  dataType: string | null;
  mappingType: string | null;
  sourceTable: string | null;
  sourceField: string | null;
  transform: string | null;
  reasoning: string | null;
  confidence: string | null;
}

export interface MappingExamplesResult {
  success: boolean;
  fieldType: string;
  examples: ExampleRow[];
  error?: string;
}

// ─── Definition ────────────────────────────────────────────────

export function getMappingExamplesToolDefinition(): ToolDefinition {
  return {
    name: "get_mapping_examples",
    description:
      "Find examples of accepted/high-confidence mappings from OTHER entities in this workspace. " +
      "Use this to learn mapping patterns for specific field types (enum, boolean, date, ID) " +
      "without seeing the answer for the current entity. Useful for understanding conventions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        fieldType: {
          type: "string",
          description:
            "Target field data type to match (e.g. 'BOOLEAN', 'ENUM', 'DATE', 'STRING', 'INTEGER'). " +
            "Use 'any' to skip type filtering.",
        },
        mappingType: {
          type: "string",
          description:
            "Optional: filter by mapping type (e.g. 'hash_id', 'direct', 'enum', 'derived')",
        },
        keyword: {
          type: "string",
          description:
            "Optional: keyword to match in field name or reasoning (e.g. 'investor', 'status', 'date')",
        },
        limit: {
          type: "number",
          description: "Max examples to return (default 5, max 15)",
        },
      },
      required: ["fieldType"],
    },
  };
}

// ─── Executor ──────────────────────────────────────────────────

export function executeMappingExampleSearch(
  input: MappingExamplesInput,
  workspaceId: string,
  excludeEntityId: string
): MappingExamplesResult {
  const { fieldType, mappingType, keyword, limit: rawLimit } = input;
  const maxResults = Math.min(rawLimit || 5, 15);

  // Load accepted/high-confidence mappings from other entities
  const mappings = db
    .select()
    .from(fieldMapping)
    .where(
      and(
        eq(fieldMapping.workspaceId, workspaceId),
        eq(fieldMapping.isLatest, true)
      )
    )
    .all()
    .filter(
      (m) =>
        m.status === "accepted" ||
        m.confidence === "high" ||
        m.confidence === "medium"
    );

  // Load source entities for name resolution
  const sourceEntities = db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "source")))
    .all();
  const sourceEntityMap = new Map(sourceEntities.map((e) => [e.id, e.displayName || e.name]));

  // Load target entities for entity name display
  const targetEntities = db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .all();
  const targetEntityMap = new Map(targetEntities.map((e) => [e.id, e.displayName || e.name]));

  const examples: ExampleRow[] = [];

  for (const m of mappings) {
    // Load target field to get entity ID, name, data type
    const tf = db
      .select({
        id: field.id,
        name: field.name,
        displayName: field.displayName,
        dataType: field.dataType,
        entityId: field.entityId,
      })
      .from(field)
      .where(eq(field.id, m.targetFieldId))
      .get();

    if (!tf) continue;

    // EXCLUDE current entity to prevent answer leaking
    if (tf.entityId === excludeEntityId) continue;

    // Filter by field type
    if (fieldType !== "any" && tf.dataType?.toUpperCase() !== fieldType.toUpperCase()) {
      continue;
    }

    // Filter by mapping type
    if (mappingType && m.mappingType !== mappingType) continue;

    // Filter by keyword
    if (keyword) {
      const kw = keyword.toLowerCase();
      const fieldName = (tf.displayName || tf.name).toLowerCase();
      const reasoning = (m.reasoning || "").toLowerCase();
      if (!fieldName.includes(kw) && !reasoning.includes(kw)) continue;
    }

    // Resolve source names
    let sourceTable: string | null = null;
    let sourceField: string | null = null;
    if (m.sourceEntityId) {
      sourceTable = sourceEntityMap.get(m.sourceEntityId) || null;
    }
    if (m.sourceFieldId) {
      const sf = db
        .select({ name: field.name })
        .from(field)
        .where(eq(field.id, m.sourceFieldId))
        .get();
      sourceField = sf?.name || null;
    }

    const entityName = targetEntityMap.get(tf.entityId) || "unknown";

    examples.push({
      entityName,
      fieldName: tf.displayName || tf.name,
      dataType: tf.dataType,
      mappingType: m.mappingType,
      sourceTable,
      sourceField,
      transform: m.transform,
      reasoning: m.reasoning,
      confidence: m.confidence,
    });

    if (examples.length >= maxResults) break;
  }

  return {
    success: true,
    fieldType,
    examples,
  };
}

// ─── Formatters ────────────────────────────────────────────────

export function formatMappingExamplesForLLM(result: MappingExamplesResult): string {
  if (!result.success) {
    return `Example search failed: ${result.error}`;
  }

  if (result.examples.length === 0) {
    return `No mapping examples found for type "${result.fieldType}". Try 'any' for fieldType or different keywords.`;
  }

  const parts: string[] = [];
  parts.push(
    `${result.examples.length} example mapping(s) for type "${result.fieldType}":\n`
  );

  for (const ex of result.examples) {
    const source = ex.sourceTable
      ? `${ex.sourceTable}${ex.sourceField ? "." + ex.sourceField : ""}`
      : "N/A";
    parts.push(`**${ex.entityName}.${ex.fieldName}** (${ex.dataType || "?"}) → ${source}`);
    if (ex.mappingType) parts.push(`  Type: ${ex.mappingType} | Confidence: ${ex.confidence || "?"}`);
    if (ex.transform && ex.transform !== "identity") {
      const xform =
        ex.transform.length > 200 ? ex.transform.slice(0, 200) + "..." : ex.transform;
      parts.push(`  Transform: ${xform}`);
    }
    if (ex.reasoning) {
      const reason =
        ex.reasoning.length > 150 ? ex.reasoning.slice(0, 150) + "..." : ex.reasoning;
      parts.push(`  Reasoning: ${reason}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

export function formatMappingExamplesForClient(result: MappingExamplesResult): {
  toolName: string;
  fieldType: string;
  exampleCount: number;
  success: boolean;
  error?: string;
} {
  return {
    toolName: "get_mapping_examples",
    fieldType: result.fieldType,
    exampleCount: result.examples.length,
    success: result.success,
    error: result.error,
  };
}
