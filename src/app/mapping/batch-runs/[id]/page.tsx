import { Suspense } from "react";
import { BatchRunDetailClient } from "./batch-run-detail-client";

export default async function BatchRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <div className="animate-pulse text-muted-foreground">
            Loading batch run...
          </div>
        </div>
      }
    >
      <BatchRunDetailClient batchRunId={id} />
    </Suspense>
  );
}
