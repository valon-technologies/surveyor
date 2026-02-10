"use client";

import { Waypoints, AlertCircle } from "lucide-react";

export function TopologyEmptySelection() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <Waypoints className="h-12 w-12 text-muted-foreground/30 mx-auto" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Select a field to view its lineage
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Choose a target field from the browser to see source mappings
          </p>
        </div>
      </div>
    </div>
  );
}

export function TopologyNoMapping() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground/30 mx-auto" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            No mapping yet
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            This field has not been mapped to a source
          </p>
        </div>
      </div>
    </div>
  );
}
