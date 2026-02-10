import { BigQuery } from "@google-cloud/bigquery";
import type { BigQueryConfig, BigQueryCredentials } from "@/types/workspace";
import type { ValidationInput, ValidationOutput, ValidationCheck } from "./runner";

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
  // Normalize: strip size specs like "VARCHAR(255)" -> "varchar"
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

  // Numeric -> String is generally safe (implicit cast)
  if (bqCat === "numeric" && vdsCat === "string") {
    return { compatible: true, detail: `BQ "${bqType}" can be cast to VDS "${vdsType}" (numeric→string)` };
  }

  // Date/datetime -> String is generally safe
  if ((bqCat === "date" || bqCat === "datetime") && vdsCat === "string") {
    return { compatible: true, detail: `BQ "${bqType}" can be cast to VDS "${vdsType}" (date→string)` };
  }

  // Boolean -> numeric/string usually works
  if (bqCat === "boolean" && (vdsCat === "numeric" || vdsCat === "string")) {
    return { compatible: true, detail: `BQ "${bqType}" can be cast to VDS "${vdsType}" (boolean→${vdsCat})` };
  }

  // Date <-> datetime often compatible
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
  credentials?: BigQueryCredentials
): Promise<ValidationOutput> {
  const bqOptions: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: config.projectId,
  };

  if (credentials) {
    bqOptions.credentials = {
      type: "authorized_user",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    };
  }

  const bq = new BigQuery(bqOptions);
  const checks: ValidationCheck[] = [];
  const errors: string[] = [];

  for (const f of input.fields) {
    const sourceTable = f.source?.table || null;
    const sourceField = f.source?.field || null;
    const transform = f.source?.transform || null;

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
        const [rows] = await bq.query({
          query: `SELECT table_name FROM \`${config.projectId}.${config.sourceDataset}\`.INFORMATION_SCHEMA.TABLES WHERE table_name = @tableName`,
          params: { tableName: sourceTable },
        });
        if (rows.length > 0) {
          checks.push({
            checkType: "table_exists",
            field: f.vds_field,
            status: "passed",
            message: `Table "${sourceTable}" exists in ${config.sourceDataset}`,
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
        const [rows] = await bq.query({
          query: `SELECT column_name, data_type FROM \`${config.projectId}.${config.sourceDataset}\`.INFORMATION_SCHEMA.COLUMNS WHERE table_name = @tableName AND column_name = @columnName`,
          params: { tableName: sourceTable, columnName: sourceField },
        });
        if (rows.length > 0) {
          bqDataType = rows[0].data_type;
          checks.push({
            checkType: "field_exists",
            field: f.vds_field,
            status: "passed",
            message: `Field "${sourceField}" exists in "${sourceTable}" (type: ${bqDataType})`,
          });
        } else {
          checks.push({
            checkType: "field_exists",
            field: f.vds_field,
            status: "failed",
            message: `Field "${sourceField}" not found in table "${sourceTable}"`,
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

    // 4. Transform SQL valid (dry run)
    if (!transform || !sourceTable) {
      checks.push({
        checkType: "transform_valid",
        field: f.vds_field,
        status: "skipped",
        message: !transform ? "No transform SQL specified" : "No source table specified",
      });
    } else {
      try {
        const query = `SELECT ${transform} FROM \`${config.projectId}.${config.sourceDataset}.${sourceTable}\` LIMIT 0`;
        await bq.createQueryJob({ query, dryRun: true });
        checks.push({
          checkType: "transform_valid",
          field: f.vds_field,
          status: "passed",
          message: "Transform SQL is valid (dry run passed)",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        checks.push({
          checkType: "transform_valid",
          field: f.vds_field,
          status: "failed",
          message: "Transform SQL is invalid",
          detail: msg,
        });
      }
    }
  }

  // Build summary
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) => c.status === "failed" || c.status === "error").length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };

  const passed = summary.failed === 0;

  // Build legacy results array for backwards compatibility
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
