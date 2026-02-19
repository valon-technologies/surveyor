"use client";

import { Suspense } from "react";
import { AtlasClient } from "./atlas-client";
import { Loader2 } from "lucide-react";

export default function AtlasPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <AtlasClient />
    </Suspense>
  );
}
