import type { BigQueryConfig, BigQueryCredentials } from "@/types/workspace";
import { runBqValidation } from "./bq-runner";

export interface ValidationInput {
  entity: string;
  fields: Array<{
    vds_field: string;
    vds_type: string | null;
    source?: {
      table: string | null;
      field: string | null;
      transform: string | null;
    };
  }>;
}

export type CheckType = "table_exists" | "field_exists" | "type_compatible" | "transform_valid";

export interface ValidationCheck {
  checkType: CheckType;
  field: string;
  status: "passed" | "failed" | "skipped" | "error";
  message: string;
  detail?: string;
}

export interface ValidationOutput {
  passed: boolean;
  checks: ValidationCheck[];
  summary: { total: number; passed: number; failed: number; skipped: number };
  results: Array<{
    field: string;
    status: "passed" | "failed" | "skipped";
    message?: string;
  }>;
  errors?: string[];
}

export async function runValidation(
  input: ValidationInput,
  bqConfig?: BigQueryConfig | null,
  credentials?: BigQueryCredentials | null
): Promise<{ status: "passed" | "failed" | "error"; output: ValidationOutput | null; errorMessage?: string; durationMs: number }> {
  if (!bqConfig) {
    return {
      status: "error",
      output: null,
      errorMessage: "BigQuery not configured. Go to Settings > BigQuery to set up your connection.",
      durationMs: 0,
    };
  }

  const start = Date.now();
  try {
    const output = await runBqValidation(input, bqConfig, credentials || undefined);
    const durationMs = Date.now() - start;
    return {
      status: output.passed ? "passed" : "failed",
      output,
      durationMs,
    };
  } catch (err) {
    return {
      status: "error",
      output: null,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}
