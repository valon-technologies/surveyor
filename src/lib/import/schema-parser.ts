import Papa from "papaparse";

export interface ParsedEntity {
  name: string;
  displayName?: string;
  description?: string;
  fields: ParsedField[];
}

export interface ParsedField {
  name: string;
  displayName?: string;
  dataType?: string;
  isRequired?: boolean;
  isKey?: boolean;
  description?: string;
  milestone?: string;
  sampleValues?: string[];
  enumValues?: string[];
}

/**
 * Parse CSV content into entities and fields.
 *
 * Supports two formats:
 * 1. Flat: columns like entity/table, field/column, type, required, key, description
 * 2. Single entity: columns are field names, first row has types
 *
 * Auto-detects by checking for "entity" or "table" column headers.
 */
export interface ParseOptions {
  /** When true, duplicate field names within an entity are deduped (last wins). Default: false. */
  deduplicateFields?: boolean;
}

export function parseCSVSchema(rawContent: string, fallbackEntityName: string, options?: ParseOptions): ParsedEntity[] {
  const result = Papa.parse<Record<string, string>>(rawContent.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parse error: ${result.errors[0].message}`);
  }

  const headers = result.meta.fields || [];
  const rows = result.data;

  // Normalize headers: collapse spaces/underscores for flexible matching
  const normalize = (s: string) => s.replace(/[\s_]+/g, "_");
  const findCol = (candidates: string[]) => {
    const normalized = candidates.map(normalize);
    return headers.find((h) => normalized.includes(normalize(h)));
  };

  // Detect entity/table column
  const entityCol = findCol(["entity", "table", "table_name", "entity_name", "object"]);
  const fieldCol = findCol(["field", "column", "column_name", "field_name", "attribute", "name"]);
  const typeCol = findCol(["type", "data_type", "datatype", "dtype"]);
  const requiredCol = findCol(["required", "is_required", "nullable", "not_null"]);
  const keyCol = findCol(["key", "is_key", "primary_key", "pk"]);
  const descCol = findCol(["description", "desc", "definition", "comment", "notes"]);
  const sampleCol = findCol(["sample", "sample_values", "examples", "example"]);
  const enumCol = findCol(["enum", "enum_values", "values", "allowed_values"]);
  const displayCol = findCol(["display_name", "display", "label"]);
  const milestoneCol = findCol(["milestone", "phase", "delivery"]);

  if (!fieldCol) {
    throw new Error(
      `Cannot find a field/column name header. Found headers: ${headers.join(", ")}`
    );
  }

  // Group by entity
  const entityMap = new Map<string, ParsedField[]>();

  for (const row of rows) {
    const entityName = entityCol ? (row[entityCol] || "").trim() : fallbackEntityName;
    const fieldName = (row[fieldCol] || "").trim();
    if (!fieldName) continue;

    if (!entityMap.has(entityName)) {
      entityMap.set(entityName, []);
    }

    const isReq = requiredCol
      ? parseBoolean(row[requiredCol], requiredCol === "nullable")
      : undefined;

    const parsedField: ParsedField = {
      name: fieldName,
      displayName: displayCol ? row[displayCol]?.trim() : undefined,
      dataType: typeCol ? row[typeCol]?.trim().toUpperCase() : undefined,
      isRequired: isReq,
      isKey: keyCol ? parseBoolean(row[keyCol]) : undefined,
      description: descCol ? row[descCol]?.trim() : undefined,
      milestone: milestoneCol ? parseMilestone(row[milestoneCol]) : undefined,
      sampleValues: sampleCol ? parsePipeList(row[sampleCol]) : undefined,
      enumValues: enumCol ? parsePipeList(row[enumCol]) : undefined,
    };

    entityMap.get(entityName)!.push(parsedField);
  }

  return Array.from(entityMap.entries()).map(([name, fields]) => {
    let finalFields = fields;
    if (options?.deduplicateFields) {
      const seen = new Map<string, ParsedField>();
      for (const f of fields) {
        seen.set(f.name, f);
      }
      finalFields = [...seen.values()];
    }
    return {
      name,
      fields: finalFields.map((f, i) => ({ ...f, sortOrder: i })),
    };
  });
}

function parseBoolean(val: string | undefined, invert = false): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  const truthy = ["true", "yes", "1", "y", "x"].includes(v);
  return invert ? !truthy : truthy;
}

function parseMilestone(val: string | undefined): string | undefined {
  if (!val || !val.trim()) return undefined;
  const trimmed = val.trim();
  // Extract M1/M2/M3/M4 from values like "M1 - SDT", "M2", etc.
  const match = trimmed.match(/^(M[1-4])\b/i);
  if (match) return match[1].toUpperCase();
  // "Not required" variants → NR
  if (/not\s+required/i.test(trimmed)) return "NR";
  return undefined;
}

function parsePipeList(val: string | undefined): string[] | undefined {
  if (!val || !val.trim()) return undefined;
  return val
    .split(/[|;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
