"use client";

import { cn } from "@/lib/utils";
import { AliasPill } from "./source-cards";
import type { PipelineColumn, PipelineSource } from "@/types/pipeline";

const TRANSFORM_STYLES: Record<string, string> = {
  identity: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  expression: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  literal: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  hash_id: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  null: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

function TransformBadge({ transform }: { transform: string | null }) {
  const key = transform?.toLowerCase() ?? "null";
  const style = TRANSFORM_STYLES[key] ?? TRANSFORM_STYLES.null;
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", style)}>
      {key}
    </span>
  );
}

interface PipelineColumnTableProps {
  columns: PipelineColumn[];
  sources: PipelineSource[];
  onColumnClick?: (targetColumn: string) => void;
}

export function PipelineColumnTable({ columns, sources, onColumnClick }: PipelineColumnTableProps) {
  const aliasIndex = new Map(sources.map((s, i) => [s.alias, i]));

  function parseSource(source: PipelineColumn["source"]): { alias: string | null; field: string } | null {
    if (typeof source === "string") {
      const dot = source.indexOf(".");
      if (dot === -1) return { alias: null, field: source };
      return { alias: source.slice(0, dot), field: source.slice(dot + 1) };
    }
    if (source && typeof source === "object" && !Array.isArray(source)) {
      const literal = (source as Record<string, unknown>).literal;
      if (literal !== undefined) return { alias: null, field: `"${literal}"` };
    }
    return null;
  }

  return (
    <div className="px-4 py-3 border-t">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Columns ({columns.length})
      </h3>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 text-left text-[10px] font-medium text-muted-foreground">
              <th className="px-3 py-1.5 w-48">Target Column</th>
              <th className="px-3 py-1.5">Source</th>
              <th className="px-3 py-1.5 w-20">Transform</th>
              <th className="px-3 py-1.5 w-16">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {columns.map((col) => {
              const ref = parseSource(col.source);
              const isNull = col.transform?.toLowerCase() === "null" || (Array.isArray(col.source) && col.source.length === 0);

              return (
                <tr
                  key={col.target_column}
                  className={cn(
                    "hover:bg-muted/30 transition-colors",
                    onColumnClick && "cursor-pointer",
                    isNull && "opacity-50"
                  )}
                  onClick={() => onColumnClick?.(col.target_column)}
                >
                  <td className="px-3 py-1.5 font-medium">{col.target_column}</td>
                  <td className="px-3 py-1.5">
                    {ref ? (
                      <span className="flex items-center gap-1.5">
                        {ref.alias && (
                          <AliasPill
                            alias={ref.alias}
                            index={aliasIndex.get(ref.alias) ?? 0}
                          />
                        )}
                        <span className="text-muted-foreground truncate max-w-[200px]" title={ref.field}>
                          {ref.field}
                        </span>
                      </span>
                    ) : col.expression ? (
                      <span className="text-muted-foreground font-mono text-[10px] truncate max-w-[250px] block" title={col.expression}>
                        {col.expression}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <TransformBadge transform={isNull ? "null" : col.transform} />
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {col.dtype ?? "--"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
