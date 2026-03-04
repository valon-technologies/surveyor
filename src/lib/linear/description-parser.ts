/**
 * Parse structured markdown descriptions from Linear mapping field issues.
 *
 * Expected format:
 * **Field:** field_name
 * **Type:**
 * ```
 * STRING
 * ```
 * **Definition:**
 * ```
 * Some definition text
 * ```
 * **Enum Values:**
 * ```
 * VALUE_A, VALUE_B, VALUE_C
 * ```
 * **ACDC Field:**
 * ```
 * TableName.FieldName
 * ```
 * **Mapping Logic:**
 * ```
 * expression or description
 * ```
 */

export interface ParsedFieldDescription {
  fieldName: string | null;
  dataType: string | null;
  definition: string | null;
  enumValues: string[] | null;
  acdcField: string | null;
  mappingLogic: string | null;
}

/** Extract the code-block content after a **Label:** header */
function extractSection(description: string, label: string): string | null {
  // Match: **Label:**  followed by ``` block
  const pattern = new RegExp(
    `\\*\\*${label}:\\*\\*[\\s\\S]*?\`\`\`\\s*\\n([\\s\\S]*?)\`\`\``,
    "i",
  );
  const match = description.match(pattern);
  if (!match) return null;
  const content = match[1].trim();
  if (!content || content === "(empty)") return null;
  return content;
}

/** Extract inline content after **Label:** (no code block) */
function extractInline(description: string, label: string): string | null {
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, "i");
  const match = description.match(pattern);
  if (!match) return null;
  const content = match[1].trim();
  if (!content || content === "(empty)") return null;
  return content;
}

export function parseFieldDescription(description: string | null): ParsedFieldDescription {
  if (!description) {
    return { fieldName: null, dataType: null, definition: null, enumValues: null, acdcField: null, mappingLogic: null };
  }

  const fieldName = extractInline(description, "Field");
  const dataType = extractSection(description, "Type");
  const definition = extractSection(description, "Definition");
  const acdcField = extractSection(description, "ACDC Field");
  const mappingLogic = extractSection(description, "Mapping Logic");

  // Enum values: comma or newline separated
  const rawEnums = extractSection(description, "Enum Values");
  let enumValues: string[] | null = null;
  if (rawEnums) {
    enumValues = rawEnums
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (enumValues.length === 0) enumValues = null;
  }

  return { fieldName, dataType, definition, enumValues, acdcField, mappingLogic };
}

/** Parse ACDC Field string into source entity + field names.
 *  Handles: "TableName.FieldName", "TABLENAME", "TableName.FieldName, OtherTable.OtherField"
 */
export function parseAcdcField(acdcField: string): { sourceEntity: string; sourceField: string }[] {
  const results: { sourceEntity: string; sourceField: string }[] = [];

  // Split by comma for multi-source
  const parts = acdcField.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes(".")) {
      const [entity, ...fieldParts] = part.split(".");
      results.push({ sourceEntity: entity.trim(), sourceField: fieldParts.join(".").trim() });
    } else {
      // Just a field name without table — can't resolve entity
      results.push({ sourceEntity: "", sourceField: part });
    }
  }

  return results;
}
