/**
 * Parser for transfer source files (flat file field lists).
 *
 * Expects CSV format matching stockton-fields.csv:
 *   position, field_name, sample_value
 *
 * Also parses requirement data CSVs (data-dict-required-fields.csv format):
 *   field_name, requirement_type, entity_type, requirement_detail
 */

export interface TransferSourceField {
  position: number;
  fieldName: string;
  sampleValue: string;
}

export interface ParsedTransferSource {
  fields: TransferSourceField[];
  totalFields: number;
}

export interface RequirementField {
  fieldName: string;
  requirementType: string; // ALWAYS_REQUIRED | CONDITIONALLY_REQUIRED | NOT_REQUIRED
  entityType: string;
  requirementDetail: string;
}

export interface ParsedRequirements {
  fields: RequirementField[];
  lookup: Map<string, RequirementField>;
}

/**
 * Parse a transfer source CSV (position, field_name, sample_value).
 * Handles flexible header names and optional columns.
 */
export function parseTransferSourceCSV(csv: string): ParsedTransferSource {
  const lines = csv.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { fields: [], totalFields: 0 };
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map((h) => h.toLowerCase().trim());

  // Find column indices with flexible matching
  const posIdx = headers.findIndex((h) =>
    h === "position" || h === "pos" || h === "index" || h === "field_position"
  );
  const nameIdx = headers.findIndex((h) =>
    h === "field_name" || h === "name" || h === "fieldname" || h === "field"
  );
  const sampleIdx = headers.findIndex((h) =>
    h === "sample_value" || h === "sample" || h === "samplevalue" || h === "example"
  );

  if (nameIdx === -1) {
    throw new Error(
      "Source CSV must have a 'field_name' (or 'name', 'field') column. " +
      `Found headers: ${headers.join(", ")}`
    );
  }

  const fields: TransferSourceField[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const fieldName = cols[nameIdx]?.trim() || "";
    if (!fieldName) continue;

    fields.push({
      position: posIdx >= 0 ? parseInt(cols[posIdx] || String(i - 1), 10) : i - 1,
      fieldName,
      sampleValue: sampleIdx >= 0 ? (cols[sampleIdx]?.trim() || "") : "",
    });
  }

  return { fields, totalFields: fields.length };
}

/**
 * Parse a requirement data CSV (field_name, requirement_type, entity_type, requirement_detail).
 */
export function parseRequirementCSV(csv: string): ParsedRequirements {
  const lines = csv.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { fields: [], lookup: new Map() };
  }

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const nameIdx = headers.findIndex((h) => h === "field_name" || h === "name");
  const typeIdx = headers.findIndex((h) => h === "requirement_type" || h === "type");
  const entityIdx = headers.findIndex((h) => h === "entity_type" || h === "entity");
  const detailIdx = headers.findIndex((h) => h === "requirement_detail" || h === "detail");

  if (nameIdx === -1 || typeIdx === -1) {
    throw new Error("Requirement CSV must have 'field_name' and 'requirement_type' columns.");
  }

  const fields: RequirementField[] = [];
  const lookup = new Map<string, RequirementField>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const fieldName = cols[nameIdx]?.trim() || "";
    if (!fieldName) continue;

    const field: RequirementField = {
      fieldName,
      requirementType: cols[typeIdx]?.trim() || "",
      entityType: entityIdx >= 0 ? (cols[entityIdx]?.trim() || "") : "",
      requirementDetail: detailIdx >= 0 ? (cols[detailIdx]?.trim() || "") : "",
    };
    fields.push(field);
    lookup.set(fieldName, field);
  }

  return { fields, lookup };
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
