"use client";

import { useState } from "react";
import { useSotMappingDetail } from "@/queries/sot-mapping-queries";
import { SotFieldTable } from "./field-table";
import { SotSourceSummary } from "./source-summary";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Loader2, Layers, Plug, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StagingComponentDetail, SotColumn } from "@/lib/sot/yaml-parser";

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
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
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
          {/* IO Config — onboarding task details */}
          {data.onboardingDetail && data.onboardingDetail.length > 0 && (
            <OnboardingDetailSection details={data.onboardingDetail} entityColumns={data.columns} />
          )}
          {(!data.onboardingDetail || data.onboardingDetail.length === 0) && (
            <div className="mt-2 border border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                No onboarding config
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                This entity has no front-porch onboarding task. Mappings exist but may not flow into cellar yet.
              </p>
            </div>
          )}
        </div>

        {/* Field Table — first, since this is what reviewers care about most */}
        <div>
          <h2 className="text-sm font-semibold mb-3">Field Mappings</h2>
          <SotFieldTable columns={data.columns} />
        </div>

        {/* Staging Component Detail — for assembly parents, show ACDC sources */}
        {data.stagingDetail && data.stagingDetail.length > 0 && (
          <StagingComponentsSection components={data.stagingDetail} />
        )}

        {/* Source Summary */}
        <SotSourceSummary sources={data.sources} joins={data.joins} />

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

function StagingComponentsSection({
  components,
}: {
  components: StagingComponentDetail[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-blue-500" />
        Staging Components (ACDC Sources)
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        This entity assembles from staging components. Expand each to see the
        actual ACDC source fields.
      </p>
      <div className="space-y-1">
        {components.map((comp) => {
          const isOpen = expanded.has(comp.componentName);
          return (
            <div key={comp.componentName} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(comp.componentName)}
                className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="font-mono text-xs font-medium">
                  {comp.componentName}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {comp.columns.length} fields
                </span>
                <span className="flex-1" />
                <span className="text-[10px] text-muted-foreground">
                  ACDC: {comp.acdcSources.join(", ")}
                </span>
              </button>
              {isOpen && (
                <div className="border-t px-3 py-2">
                  <SotFieldTable columns={comp.columns} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface OnboardingTaskDetail {
  taskType: string;
  role: "primary" | "dependency";
  consumedFields: string[];
}

function OnboardingDetailSection({
  details,
  entityColumns,
}: {
  details: OnboardingTaskDetail[];
  entityColumns: SotColumn[];
}) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  // Build set of field names in this entity's mapping
  const mappedFields = new Set(entityColumns.map((c) => c.targetColumn));

  // Deduplicate tasks (same task can appear twice from different config files)
  const seen = new Set<string>();
  const uniqueDetails = details.filter((d) => {
    if (seen.has(d.taskType)) return false;
    seen.add(d.taskType);
    return true;
  });

  // Sort: primary tasks first, then dependencies
  const sorted = [...uniqueDetails].sort((a, b) => {
    if (a.role === "primary" && b.role !== "primary") return -1;
    if (a.role !== "primary" && b.role === "primary") return 1;
    return a.taskType.localeCompare(b.taskType);
  });

  return (
    <div className="mt-2 border border-green-200 dark:border-green-800 rounded-lg bg-green-50 dark:bg-green-950/20 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2">
        <Plug className="h-3.5 w-3.5 text-green-600" />
        <p className="text-xs font-semibold text-green-800 dark:text-green-300">
          Onboarding Pipeline ({sorted.length} task{sorted.length !== 1 ? "s" : ""})
        </p>
      </div>
      <div className="border-t border-green-200 dark:border-green-800 divide-y divide-green-200 dark:divide-green-800">
        {sorted.map((task) => {
          const isOpen = expandedTask === task.taskType;
          // Which consumed fields exist in this entity's mapping?
          const relevantFields = task.consumedFields.filter((f) => mappedFields.has(f));
          const otherFields = task.consumedFields.filter((f) => !mappedFields.has(f));

          return (
            <div key={task.taskType}>
              <button
                onClick={() => setExpandedTask(isOpen ? null : task.taskType)}
                className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-green-100/50 dark:hover:bg-green-900/20 transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3 text-green-600 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-green-600 shrink-0" />
                )}
                <span className="text-xs font-mono font-medium text-green-800 dark:text-green-300">
                  {task.taskType}
                </span>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium",
                    task.role === "primary"
                      ? "bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-200"
                      : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
                  )}
                >
                  {task.role === "primary" ? "Primary entity" : "Dependency"}
                </span>
                <span className="flex-1" />
                {relevantFields.length > 0 && (
                  <span className="text-[10px] text-green-700 dark:text-green-400">
                    {relevantFields.length} field{relevantFields.length !== 1 ? "s" : ""} consumed
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-2 pt-1">
                  {task.role === "primary" ? (
                    <p className="text-[11px] text-green-700 dark:text-green-400 mb-2">
                      This is the primary entity for this onboarding task. These fields are read during onboarding and written to cellar.
                    </p>
                  ) : (
                    <p className="text-[11px] text-green-700 dark:text-green-400 mb-2">
                      This entity is a dependency — its data is referenced during onboarding but the task primarily operates on a different entity.
                    </p>
                  )}
                  {relevantFields.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-semibold text-green-800 dark:text-green-300 mb-1">
                        Fields consumed from this entity:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {relevantFields.map((f) => (
                          <span
                            key={f}
                            className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-200"
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {otherFields.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-green-700 dark:text-green-400 mb-1">
                        Other fields consumed (from other entities in this task):
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {otherFields.map((f) => (
                          <span
                            key={f}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-500"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {task.consumedFields.length === 0 && (
                    <p className="text-[10px] text-green-600 dark:text-green-500 italic">
                      No specific field references found in the task config.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
