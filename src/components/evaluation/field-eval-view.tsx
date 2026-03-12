"use client";

import { useState } from "react";
import { SourceMatchBadge, TransformMatchBadge } from "./accuracy-badge";
import type { FieldSourceMatch } from "@/lib/evaluation/source-matcher";
import { cn } from "@/lib/utils";

interface FieldEvalViewProps {
  fieldResults: FieldSourceMatch[];
}

type SortKey = "field" | "sourceMatch" | "transformMatch";

const SOURCE_ORDER: Record<string, number> = {
  DISJOINT: 0, NO_GEN: 1, OVERLAP: 2, SUBSET: 3, SUPERSET: 4,
  EXACT: 5, BOTH_NULL: 6, SOT_NULL: 7, NO_SOT: 8,
};

const TRANSFORM_ORDER: Record<string, number> = {
  WRONG: 0, PARTIAL: 1, MATCH: 2, "N/A": 3,
};

export function FieldEvalView({ fieldResults }: FieldEvalViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("sourceMatch");
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const hasTransform = fieldResults.some((r) => r.transformMatch != null);

  const sorted = [...fieldResults].sort((a, b) => {
    if (sortKey === "field") return a.field.localeCompare(b.field);
    if (sortKey === "transformMatch") {
      const ao = TRANSFORM_ORDER[a.transformMatch ?? "N/A"] ?? 9;
      const bo = TRANSFORM_ORDER[b.transformMatch ?? "N/A"] ?? 9;
      return ao - bo;
    }
    return (SOURCE_ORDER[a.matchType] ?? 9) - (SOURCE_ORDER[b.matchType] ?? 9);
  });

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="max-h-[600px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted/50 border-b">
              <th
                className="text-left px-3 py-2 font-medium cursor-pointer hover:text-primary"
                onClick={() => setSortKey("field")}
              >
                Field {sortKey === "field" && "↕"}
              </th>
              <th
                className="text-left px-3 py-2 font-medium w-24 cursor-pointer hover:text-primary"
                onClick={() => setSortKey("sourceMatch")}
              >
                Source {sortKey === "sourceMatch" && "↕"}
              </th>
              <th className="text-left px-3 py-2 font-medium">Generated Source</th>
              <th className="text-left px-3 py-2 font-medium">SOT Source</th>
              {hasTransform && (
                <>
                  <th
                    className="text-left px-3 py-2 font-medium w-24 cursor-pointer hover:text-primary"
                    onClick={() => setSortKey("transformMatch")}
                  >
                    Transform {sortKey === "transformMatch" && "↕"}
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Generated Transform</th>
                  <th className="text-left px-3 py-2 font-medium">SOT Transform</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <>
                <tr
                  key={r.field}
                  className={cn(
                    "border-b last:border-0 cursor-pointer transition-colors",
                    expandedField === r.field ? "bg-primary/5" : "hover:bg-muted/30",
                  )}
                  onClick={() => setExpandedField(expandedField === r.field ? null : r.field)}
                >
                  <td className="px-3 py-1.5 font-mono text-xs">{r.field}</td>
                  <td className="px-3 py-1.5">
                    <SourceMatchBadge matchType={r.matchType} />
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                    {r.genSources.length > 0 ? r.genSources.join(", ") : "\u2014"}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                    {r.sotSources.length > 0 ? r.sotSources.join(", ") : "\u2014"}
                  </td>
                  {hasTransform && (
                    <>
                      <td className="px-3 py-1.5">
                        {r.transformMatch ? (
                          <TransformMatchBadge matchType={r.transformMatch} />
                        ) : (
                          <span className="text-xs text-muted-foreground">\u2014</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                        {r.genTransformSummary || "\u2014"}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                        {r.sotTransformSummary || "\u2014"}
                      </td>
                    </>
                  )}
                </tr>
                {expandedField === r.field && r.transformExplanation && (
                  <tr key={`${r.field}-detail`} className="bg-muted/20 border-b">
                    <td colSpan={hasTransform ? 7 : 4} className="px-3 py-2">
                      <div className="text-xs space-y-1">
                        <div className="font-medium text-muted-foreground">Transform Comparison</div>
                        <p className="text-muted-foreground">{r.transformExplanation}</p>
                        {r.transformSimilarity != null && (
                          <span className="inline-block mt-1 text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">
                            similarity: {r.transformSimilarity.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
