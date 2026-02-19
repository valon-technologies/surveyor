import { Suspense } from "react";
import { EntityDiscussClient } from "./entity-discuss-client";

export default function EntityDiscussPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <EntityDiscussClient />
    </Suspense>
  );
}
