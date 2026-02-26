"use client";

import { SourceMatchBadge } from "./accuracy-badge";
import type { FieldSourceMatch } from "@/lib/evaluation/source-matcher";

interface FieldEvalViewProps {
  fieldResults: FieldSourceMatch[];
}

export function FieldEvalView({ fieldResults }: FieldEvalViewProps) {
  // Sort: scorable results first (by match quality), then non-scorable
  const sorted = [...fieldResults].sort((a, b) => {
    const order: Record<string, number> = {
      DISJOINT: 0,
      NO_GEN: 1,
      OVERLAP: 2,
      SUBSET: 3,
      SUPERSET: 4,
      EXACT: 5,
      BOTH_NULL: 6,
      SOT_NULL: 7,
      NO_SOT: 8,
    };
    return (order[a.matchType] ?? 9) - (order[b.matchType] ?? 9);
  });

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left px-3 py-2 font-medium">Field</th>
            <th className="text-left px-3 py-2 font-medium w-24">Match</th>
            <th className="text-left px-3 py-2 font-medium">Generated Sources</th>
            <th className="text-left px-3 py-2 font-medium">SOT Sources</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.field} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-3 py-1.5 font-mono text-xs">{r.field}</td>
              <td className="px-3 py-1.5">
                <SourceMatchBadge matchType={r.matchType} />
              </td>
              <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                {r.genSources.length > 0 ? r.genSources.join(", ") : "\u2014"}
              </td>
              <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                {r.sotSources.length > 0 ? r.sotSources.join(", ") : "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
