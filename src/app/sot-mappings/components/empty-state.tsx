"use client";

import { FileSpreadsheet } from "lucide-react";

export function SotMappingsEmpty() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
      <FileSpreadsheet className="h-12 w-12 mb-4 opacity-30" />
      <p className="text-sm font-medium">Select an entity to view its SOT mapping</p>
      <p className="text-xs mt-1">
        Click an entity in the left panel to see its production mapping
      </p>
    </div>
  );
}
