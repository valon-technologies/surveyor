import { Suspense } from "react";
import { DiscussClient } from "./discuss-client";

export default function DiscussPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <DiscussClient />
    </Suspense>
  );
}
