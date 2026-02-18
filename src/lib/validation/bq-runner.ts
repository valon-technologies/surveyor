import type { BigQueryConfig } from "@/types/workspace";
import type { ValidationInput, ValidationOutput, ValidationCheck } from "./runner";
import { listTables, getTableSchema, type BqField } from "@/lib/bigquery/gestalt-client";

// Map BQ types to broad categories for compatibility checking
const BQ_TYPE_CATEGORIES: Record<string, string> = {
  STRING: "string",
  BYTES: "string",
  INT64: "numeric",
  INTEGER: "numeric",
  FLOAT64: "numeric",
  FLOAT: "numeric",
  NUMERIC: "numeric",
  BIGNUMERIC: "numeric",
  BOOL: "boolean",
  BOOLEAN: "boolean",
  DATE: "date",
  DATETIME: "datetime",
  TIME: "time",
  TIMESTAMP: "datetime",
  JSON: "string",
  GEOGRAPHY: "string",
  STRUCT: "complex",
  RECORD: "complex",
  ARRAY: "complex",
};

// Map VDS/target types to the same categories
const VDS_TYPE_CATEGORIES: Record<string, string> = {
  // String types
  string: "string",
  varchar: "string",
  text: "string",
  char: "string",
  nvarchar: "string",
  // Numeric types
  integer: "numeric",
  int: "numeric",
  bigint: "numeric",
  smallint: "numeric",
  tinyint: "numeric",
  decimal: "numeric",
  numeric: "numeric",
  float: "numeric",
  double: "numeric",
  number: "numeric",
  money: "numeric",
  // Boolean
  boolean: "boolean",
  bool: "boolean",
  bit: "boolean",
  // Date/time
  date: "date",
  datetime: "datetime",
  timestamp: "datetime",
  time: "time",
  datetime2: "datetime",
  smalldatetime: "datetime",
};

function categorizeBqType(bqType: string): string {
  return BQ_TYPE_CATEGORIES[bqType.toUpperCase()] || "unknown";
}

function categorizeVdsType(vdsType: string): string {
  const base = vdsType.toLowerCase().replace(/\(.*\)/, "").trim();
  return VDS_TYPE_CATEGORIES[base] || "unknown";
}

function areTypesCompatible(bqType: string, vdsType: string): { compatible: boolean; detail: string } {
  const bqCat = categorizeBqType(bqType);
  const vdsCat = categorizeVdsType(vdsType);

  if (bqCat === "unknown" || vdsCat === "unknown") {
    return { compatible: true, detail: `Cannot determine compatibility: BQ "${bqType}" vs VDS "${vdsType}"` };
  }

  if (bqCat === vdsCat) {
    return { compatible: true, detail: `BQ "${bqType}" (${bqCat}) is compatible with VDS "${vdsType}" (${vdsCat})` };
  }

  if (bqCat === "numeric" && vdsCat === "string") {
    return { compatible: true, detail: `BQ "${bqType}" can be cast to VDS "${vdsType}" (numeric→string)` };
  }

  if ((bqCat === "date" || bqCat === "datetime") && vdsCat === "string") {
    return { compatible: true, detail: `BQ "${bqType}" can be cast to VDS "${vdsType}" (date→string)` };
  }

  if (bqCat === "boolean" && (vdsCat === "numeric" || vdsCat === "string")) {
    return { compatible: true, detail: `BQ "${bqType}" can be cast to VDS "${vdsType}" (boolean→${vdsCat})` };
  }

  if ((bqCat === "date" && vdsCat === "datetime") || (bqCat === "datetime" && vdsCat === "date")) {
    return { compatible: true, detail: `BQ "${bqType}" and VDS "${vdsType}" are date-compatible (may truncate time)` };
  }

  return {
    compatible: false,
    detail: `BQ "${bqType}" (${bqCat}) is not compatible with VDS "${vdsType}" (${vdsCat}) — may need a CAST in transform`,
  };
}

export async function runBqValidation(
  input: ValidationInput,
  config: BigQueryConfig,
): Promise<ValidationOutput> {
  const checks: ValidationCheck[] = [];
  const errors: string[] = [];

  // Cache: fetch tables list once, and cache schemas per table
  let tablesList: string[] | null = null;
  const schemaCache: Record<string, BqField[]> = {};

  async function getTables(): Promise<string[]> {
    if (!tablesList) {
      tablesList = await listTables(config.projectId, config.sourceDataset);
    }
    return tablesList;
  }

  async function getFields(tableName: string): Promise<BqField[]> {
    if (!schemaCache[tableName]) {
      const schema = await getTableSchema(config.projectId, config.sourceDataset, tableName);
      schemaCache[tableName] = schema.schema.fields;
    }
    return schemaCache[tableName];
  }

  for (const f of input.fields) {
    const sourceTable = f.source?.table || null;
    const sourceField = f.source?.field || null;

    // 1. Table exists
    if (!sourceTable) {
      checks.push({
        checkType: "table_exists",
        field: f.vds_field,
        status: "skipped",
        message: "No source table specified",
      });
    } else {
      try {
        const tables = await getTables();
        // Case-insensitive match
        const match = tables.find((t) => t.toLowerCase() === sourceTable.toLowerCase());
        if (match) {
          checks.push({
            checkType: "table_exists",
            field: f.vds_field,
            status: "passed",
            message: `Table "${match}" exists in ${config.sourceDataset}`,
          });
        } else {
          checks.push({
            checkType: "table_exists",
            field: f.vds_field,
            status: "failed",
            message: `Table "${sourceTable}" not found in ${config.sourceDataset}`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        checks.push({
          checkType: "table_exists",
          field: f.vds_field,
          status: "error",
          message: `Error checking table "${sourceTable}"`,
          detail: msg,
        });
        errors.push(msg);
      }
    }

    // 2. Field exists
    let bqDataType: string | null = null;
    if (!sourceTable || !sourceField) {
      checks.push({
        checkType: "field_exists",
        field: f.vds_field,
        status: "skipped",
        message: "No source table/field specified",
      });
    } else {
      try {
        // Use the actual table name (case-matched) from the tables list
        const tables = await getTables();
        const actualTable = tables.find((t) => t.toLowerCase() === sourceTable.toLowerCase()) || sourceTable;
        const fields = await getFields(actualTable);
        const match = fields.find((fld) => fld.name.toLowerCase() === sourceField.toLowerCase());
        if (match) {
          bqDataType = match.type;
          checks.push({
            checkType: "field_exists",
            field: f.vds_field,
            status: "passed",
            message: `Field "${match.name}" exists in "${actualTable}" (type: ${bqDataType})`,
          });
        } else {
          checks.push({
            checkType: "field_exists",
            field: f.vds_field,
            status: "failed",
            message: `Field "${sourceField}" not found in table "${actualTable}"`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        checks.push({
          checkType: "field_exists",
          field: f.vds_field,
          status: "error",
          message: `Error checking field "${sourceField}"`,
          detail: msg,
        });
        errors.push(msg);
      }
    }

    // 3. Type compatible
    if (!bqDataType || !f.vds_type) {
      checks.push({
        checkType: "type_compatible",
        field: f.vds_field,
        status: "skipped",
        message: !bqDataType
          ? "Source field type unknown (field check must pass first)"
          : "No target type specified",
      });
    } else {
      const compat = areTypesCompatible(bqDataType, f.vds_type);
      checks.push({
        checkType: "type_compatible",
        field: f.vds_field,
        status: compat.compatible ? "passed" : "failed",
        message: compat.compatible
          ? "Types are compatible"
          : "Type mismatch — transform may be needed",
        detail: compat.detail,
      });
    }

    // 4. Transform SQL — skipped (Gestalt query endpoint not available for dry-run)
    checks.push({
      checkType: "transform_valid",
      field: f.vds_field,
      status: "skipped",
      message: "Transform validation not available via Gestalt",
    });
  }

  // Build summary
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) => c.status === "failed" || c.status === "error").length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };

  const passed = summary.failed === 0;

  const results = input.fields.map((f) => {
    const fieldChecks = checks.filter((c) => c.field === f.vds_field);
    const anyFailed = fieldChecks.some((c) => c.status === "failed" || c.status === "error");
    const allSkipped = fieldChecks.every((c) => c.status === "skipped");
    return {
      field: f.vds_field,
      status: (allSkipped ? "skipped" : anyFailed ? "failed" : "passed") as "passed" | "failed" | "skipped",
      message: anyFailed
        ? fieldChecks.find((c) => c.status === "failed" || c.status === "error")?.message
        : undefined,
    };
  });

  return { passed, checks, summary, results, errors: errors.length > 0 ? errors : undefined };
}
