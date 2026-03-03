"use client";

import { Suspense } from "react";
import { GroundTruthClient } from "./ground-truth-client";
import { Loader2 } from "lucide-react";

export default function GroundTruthPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <GroundTruthClient />
    </Suspense>
  );
}
