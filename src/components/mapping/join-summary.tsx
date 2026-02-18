"use client";

import { AliasPill, getSourceColor } from "./source-cards";
import { ArrowRight } from "lucide-react";
import type { PipelineJoin, PipelineSource } from "@/types/pipeline";

interface JoinSummaryProps {
  joins: PipelineJoin[];
  sources: PipelineSource[];
}

export function JoinSummary({ joins, sources }: JoinSummaryProps) {
  if (joins.length === 0) return null;

  // Build alias → index map
  const aliasIndex = new Map(sources.map((s, i) => [s.alias, i]));

  return (
    <div className="px-4 py-3 border-t">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Joins
      </h3>
      <div className="space-y-1.5">
        {joins.map((join, i) => {
          const leftIdx = aliasIndex.get(join.left) ?? 0;
          const rightIdx = aliasIndex.get(join.right) ?? 0;
          const onClause = join.on.join(", ");

          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <AliasPill alias={join.left} index={leftIdx} />
              <span className="text-muted-foreground whitespace-nowrap">
                {join.how?.toUpperCase() || "LEFT"} JOIN
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <AliasPill alias={join.right} index={rightIdx} />
              <span className="text-muted-foreground truncate" title={onClause}>
                ON: {onClause}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
