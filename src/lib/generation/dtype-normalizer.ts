/**
 * Shared dtype normalizer — maps FIELD_TYPES constants to valid YAML pipeline dtypes.
 * Used by pipeline-synthesizer and yaml-rebuilder.
 */

const DTYPE_MAP: Record<string, string> = {
  string: "string",
  enum: "string",
  json: "string",
  array: "string",
  number: "float",
  decimal: "float",
  integer: "int",
  date: "date",
  timestamp: "datetime",
  boolean: "boolean",
};

export function normalizeDtype(dataType: string | null): string {
  if (!dataType) return "string";
  return DTYPE_MAP[dataType.toLowerCase()] ?? "string";
}
