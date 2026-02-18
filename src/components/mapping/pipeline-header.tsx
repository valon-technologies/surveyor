"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, AlertTriangle } from "lucide-react";
import type { EntityPipelineWithColumns } from "@/types/pipeline";

interface PipelineHeaderProps {
  pipeline: EntityPipelineWithColumns;
  onExport: () => void;
}

export function PipelineHeader({ pipeline, onExport }: PipelineHeaderProps) {
  const sourceCount = pipeline.sources.length;
  const joinCount = pipeline.joins?.length ?? 0;
  const columnCount = pipeline.columns.length;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">{pipeline.tableName}</h2>
        <Badge variant="outline" className="text-[10px] h-5">
          v{pipeline.version}
        </Badge>
        <Badge
          variant="secondary"
          className="text-[10px] h-5"
        >
          {pipeline.structureType === "assembly" ? "Assembly" : "Flat"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {sourceCount} source{sourceCount !== 1 ? "s" : ""}
          {joinCount > 0 && <> &middot; {joinCount} join{joinCount !== 1 ? "s" : ""}</>}
          {" "}&middot; {columnCount} column{columnCount !== 1 ? "s" : ""}
        </span>
        {pipeline.isStale && (
          <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Stale
          </span>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onExport} className="h-7 text-xs">
        <Download className="h-3 w-3 mr-1" />
        Export YAML
      </Button>
    </div>
  );
}
