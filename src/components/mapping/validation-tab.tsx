"use client";

import { CheckCircle, XCircle, AlertTriangle, MinusCircle, Loader2, FlaskConical, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunValidation, useLatestValidation } from "@/queries/mapping-queries";
import Link from "next/link";
import type { ValidationCheck } from "@/lib/validation/runner";

interface ValidationTabProps {
  mappingId: string | undefined;
}

const CHECK_TYPE_LABELS: Record<string, string> = {
  table_exists: "Table Exists",
  field_exists: "Field Exists",
  type_compatible: "Type Compatible",
  transform_valid: "Transform SQL",
};

function CheckIcon({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />;
    case "error":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />;
    case "skipped":
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    default:
      return null;
  }
}

export function ValidationTab({ mappingId }: ValidationTabProps) {
  const runValidation = useRunValidation();
  const { data: latestValidation } = useLatestValidation(mappingId);

  if (!mappingId) {
    return (
      <div className="p-4 text-center space-y-2">
        <FlaskConical className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Save a mapping first to run validation.
        </p>
      </div>
    );
  }

  const output = latestValidation?.output as {
    checks?: ValidationCheck[];
    summary?: { total: number; passed: number; failed: number; skipped: number };
  } | null;

  const isBqNotConfigured =
    latestValidation?.status === "error" &&
    latestValidation?.errorMessage?.includes("BigQuery not configured");

  const isBqNoCredentials =
    latestValidation?.status === "error" &&
    (latestValidation?.errorMessage?.includes("default credentials") ||
     latestValidation?.errorMessage?.includes("GOOGLE_APPLICATION_CREDENTIALS"));

  return (
    <div className="p-4 space-y-4">
      {/* Run button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => runValidation.mutate(mappingId)}
        disabled={runValidation.isPending}
        className="w-full"
      >
        {runValidation.isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            Validating...
          </>
        ) : (
          <>
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
            Run Validation
          </>
        )}
      </Button>

      {/* BQ not configured state */}
      {isBqNotConfigured && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-3 text-xs text-amber-700 dark:text-amber-300 space-y-2">
          <div className="flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            <span className="font-medium">BigQuery not configured</span>
          </div>
          <p>
            Configure your BigQuery connection to enable source table validation.
          </p>
          <Link
            href="/settings/bigquery"
            className="inline-flex items-center text-xs font-medium text-amber-800 dark:text-amber-200 underline underline-offset-2"
          >
            Go to Settings
          </Link>
        </div>
      )}

      {/* BQ no credentials state */}
      {isBqNoCredentials && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-3 text-xs text-amber-700 dark:text-amber-300 space-y-2">
          <div className="flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            <span className="font-medium">No BigQuery credentials</span>
          </div>
          <p>
            Run <code className="font-mono text-[11px] bg-amber-100 dark:bg-amber-900/50 px-1 rounded">gcloud auth application-default login</code> to authenticate.
          </p>
          <Link
            href="/settings/bigquery"
            className="inline-flex items-center text-xs font-medium text-amber-800 dark:text-amber-200 underline underline-offset-2"
          >
            Setup Guide
          </Link>
        </div>
      )}

      {/* Validation error (non-config) */}
      {runValidation.isError && (
        <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {runValidation.error?.message || "Validation failed"}
        </div>
      )}

      {/* Results */}
      {latestValidation && !isBqNotConfigured && !isBqNoCredentials && (
        <div className="space-y-3">
          {/* Overall status banner */}
          <div
            className={`rounded-md px-3 py-2 text-xs font-medium ${
              latestValidation.status === "passed"
                ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
                : latestValidation.status === "failed"
                  ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
                  : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
            }`}
          >
            <div className="flex items-center gap-1.5">
              {latestValidation.status === "passed" ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : latestValidation.status === "failed" ? (
                <XCircle className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {latestValidation.status === "passed"
                ? "All checks passed"
                : latestValidation.status === "failed"
                  ? "Validation failed"
                  : `Error: ${latestValidation.errorMessage}`}
            </div>
          </div>

          {/* Summary counts */}
          {output?.summary && (
            <div className="flex gap-3 text-xs">
              <span className="text-green-600 font-medium">
                {output.summary.passed} passed
              </span>
              <span className="text-red-600 font-medium">
                {output.summary.failed} failed
              </span>
              <span className="text-muted-foreground">
                {output.summary.skipped} skipped
              </span>
            </div>
          )}

          {/* Per-check breakdown */}
          {output?.checks && output.checks.length > 0 && (
            <div className="space-y-1.5">
              {output.checks.map((check, i) => (
                <div key={i} className="border rounded px-3 py-2 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <CheckIcon status={check.status} />
                    <span className="text-xs font-medium">
                      {CHECK_TYPE_LABELS[check.checkType] || check.checkType}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground pl-5.5 ml-[22px]">
                    {check.message}
                  </p>
                  {check.detail && (
                    <p className="text-[11px] text-muted-foreground/70 ml-[22px] italic">
                      {check.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Metadata footer */}
          <div className="text-[11px] text-muted-foreground text-center space-x-2">
            <span>
              {new Date(latestValidation.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {latestValidation.durationMs != null && (
              <span>({latestValidation.durationMs}ms)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
