"use client";

import { Map } from "lucide-react";

export default function AtlasPage() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Atlas</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Visual view of schema connections
        </p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Map className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm">Atlas visualization coming soon.</p>
        <p className="text-xs mt-1">
          This will show how source fields map to target fields across entities.
        </p>
      </div>
    </div>
  );
}
