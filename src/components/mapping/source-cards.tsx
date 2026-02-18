"use client";

import { cn } from "@/lib/utils";
import type { PipelineSource } from "@/types/pipeline";

const SOURCE_COLORS = [
  { border: "border-l-slate-500", bg: "bg-slate-50 dark:bg-slate-900/30", text: "text-slate-700 dark:text-slate-300" },
  { border: "border-l-sky-500", bg: "bg-sky-50 dark:bg-sky-900/30", text: "text-sky-700 dark:text-sky-300" },
  { border: "border-l-amber-500", bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300" },
  { border: "border-l-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300" },
  { border: "border-l-violet-500", bg: "bg-violet-50 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-300" },
];

export function getSourceColor(index: number) {
  return SOURCE_COLORS[index % SOURCE_COLORS.length];
}

interface SourceCardsProps {
  sources: PipelineSource[];
}

export function SourceCards({ sources }: SourceCardsProps) {
  return (
    <div className="px-4 py-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Sources
      </h3>
      <div className="flex gap-2 flex-wrap">
        {sources.map((source, i) => {
          const color = getSourceColor(i);
          const filterCount = source.filters?.length ?? 0;
          return (
            <div
              key={source.alias}
              className={cn(
                "rounded border border-l-[3px] px-3 py-2 min-w-[120px]",
                color.border,
                color.bg
              )}
            >
              <div className={cn("text-xs font-bold", color.text)}>
                {source.alias}
              </div>
              <div className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={source.table}>
                {source.table}
              </div>
              {filterCount > 0 && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {filterCount} filter{filterCount !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Inline alias pill used in other components */
export function AliasPill({ alias, index }: { alias: string; index: number }) {
  const color = getSourceColor(index);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold border",
        color.border,
        color.bg,
        color.text
      )}
    >
      {alias}
    </span>
  );
}
