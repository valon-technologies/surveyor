"use client";

import { useState } from "react";
import { useSotMappingDetail } from "@/queries/sot-mapping-queries";
import { SotFieldTable } from "./field-table";
import { SotSourceSummary } from "./source-summary";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SotMappingDetailProps {
  entityName: string;
  milestone: "m1" | "m2";
}

const structureLabel: Record<string, { text: string; className: string }> = {
  simple: {
    text: "Simple",
    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  join: {
    text: "Join",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  concat: {
    text: "Concat",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
};

export function SotMappingDetail({
  entityName,
  milestone,
}: SotMappingDetailProps) {
  const { data, isLoading, error } = useSotMappingDetail(entityName, milestone);
  const [rawYamlOpen, setRawYamlOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p className="text-sm">
          {error?.message || `No mapping found for "${entityName}"`}
        </p>
      </div>
    );
  }

  // Detect structure type from the mapping data
  const hasJoins = data.joins && data.joins.length > 0;
  const actualStructureType =
    data.rawYaml?.includes("\nconcat:") ? "concat" : hasJoins ? "join" : "simple";

  const structure = structureLabel[actualStructureType] || structureLabel.simple;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6 max-w-6xl">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-semibold font-mono">{data.table}</h1>
            <Badge variant="secondary" className="text-xs">
              {milestone.toUpperCase()}
            </Badge>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded font-medium",
                structure.className
              )}
            >
              {structure.text}
            </span>
            {data.onboardingTasks && data.onboardingTasks.length > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                title={`Onboarding tasks: ${data.onboardingTasks.join(", ")}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Onboarded
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {data.columns.length} fields &middot; {data.sources.length} sources
            {data.primaryKey && data.primaryKey.length > 0 && (
              <>
                {" "}
                &middot; PK:{" "}
                <span className="font-mono">{data.primaryKey.join(", ")}</span>
              </>
            )}
          </p>
        </div>

        {/* Source Summary */}
        <SotSourceSummary sources={data.sources} joins={data.joins} />

        {/* Field Table */}
        <div>
          <h2 className="text-sm font-semibold mb-3">Field Mappings</h2>
          <SotFieldTable columns={data.columns} />
        </div>

        {/* Raw YAML */}
        <div className="border rounded-lg">
          <button
            onClick={() => setRawYamlOpen(!rawYamlOpen)}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors"
          >
            {rawYamlOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Raw YAML
          </button>
          {rawYamlOpen && (
            <div className="border-t px-4 py-3">
              <pre className="text-xs font-mono bg-muted/50 rounded p-4 overflow-x-auto whitespace-pre-wrap">
                {data.rawYaml}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
