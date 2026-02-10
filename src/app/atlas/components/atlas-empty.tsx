"use client";

import { Globe, SearchX } from "lucide-react";

export function AtlasEmptySelection() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
      <Globe className="h-12 w-12 mb-4 opacity-30" />
      <p className="text-sm font-medium">Select a mapped field to inspect its reasoning</p>
      <p className="text-xs mt-1">
        Expand an entity in the left panel and click a field
      </p>
    </div>
  );
}

export function AtlasNoMappings() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
      <SearchX className="h-12 w-12 mb-4 opacity-30" />
      <p className="text-sm font-medium">No mappings available for inspection yet</p>
      <p className="text-xs mt-1">
        Create mappings in the Mapping editor to see them here
      </p>
    </div>
  );
}
