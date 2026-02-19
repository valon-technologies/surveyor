"use client";

import { Database } from "lucide-react";

export function AtlasEmptySelection() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
      <Database className="h-12 w-12 mb-4 opacity-30" />
      <p className="text-sm font-medium">Select an entity to preview its data</p>
      <p className="text-xs mt-1">
        Click an entity in the left panel to see sample BigQuery data
      </p>
    </div>
  );
}
