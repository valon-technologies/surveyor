"use client";

import { Badge } from "@/components/ui/badge";
import { CONFIDENCE_COLORS } from "@/lib/constants";
import type { ConfidenceLevel } from "@/lib/constants";

interface FieldSummary {
  name: string;
  dataType: string | null;
  mappingStatus: string;
  sourceInfo: string | null;
  confidence: string | null;
}

interface EntityMappingOverviewCardProps {
  entityName: string;
  entityDescription: string | null;
  fields: FieldSummary[];
}

export function EntityMappingOverviewCard({
  entityName,
  entityDescription,
  fields,
}: EntityMappingOverviewCardProps) {
  const mapped = fields.filter((f) => f.mappingStatus !== "unmapped");
  const unmapped = fields.filter((f) => f.mappingStatus === "unmapped");

  // Source pattern summary
  const sourceCounts = new Map<string, number>();
  for (const f of fields) {
    if (f.sourceInfo) {
      const table = f.sourceInfo.split(".")[0];
      sourceCounts.set(table, (sourceCounts.get(table) || 0) + 1);
    }
  }
  const sortedSources = [...sourceCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <div className="flex flex-col bg-muted/20">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-background">
        <p className="text-sm font-mono font-semibold text-foreground">
          {entityName}
        </p>
        {entityDescription && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {entityDescription}
          </p>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Completion stats */}
        <div>
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Progress
          </h4>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-600 dark:text-green-400 font-medium">
              {mapped.length} mapped
            </span>
            <span className="text-muted-foreground">/</span>
            <span className="text-orange-600 dark:text-orange-400 font-medium">
              {unmapped.length} unmapped
            </span>
            <span className="text-muted-foreground">/</span>
            <span>{fields.length} total</span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{
                width: `${fields.length > 0 ? (mapped.length / fields.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {/* Source pattern */}
        {sortedSources.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Source Tables
            </h4>
            <div className="space-y-1">
              {sortedSources.map(([table, count]) => (
                <div
                  key={table}
                  className="flex items-center justify-between text-xs"
                >
                  <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded truncate">
                    {table}
                  </code>
                  <span className="text-muted-foreground ml-2 shrink-0">
                    {count} field{count !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Compact field list */}
        <div>
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Fields
          </h4>
          <div className="max-h-[400px] overflow-y-auto space-y-0.5">
            {fields.map((f) => {
              const isUnmapped = f.mappingStatus === "unmapped";
              const confColor = f.confidence
                ? CONFIDENCE_COLORS[f.confidence as ConfidenceLevel]
                : undefined;

              return (
                <div
                  key={f.name}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] ${
                    isUnmapped
                      ? "bg-orange-50 dark:bg-orange-950/20"
                      : "bg-background"
                  }`}
                >
                  <span
                    className="font-mono truncate flex-1"
                    title={f.name}
                  >
                    {f.name}
                  </span>
                  {f.confidence && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 h-4 shrink-0"
                      style={{
                        borderColor: confColor,
                        color: confColor,
                      }}
                    >
                      {f.confidence} confidence
                    </Badge>
                  )}
                  {isUnmapped && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 h-4 text-orange-600 border-orange-300 shrink-0"
                    >
                      unmapped
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
