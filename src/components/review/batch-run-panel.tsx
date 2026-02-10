"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStartBatchRun, useBatchRunPoll, useBatchRuns } from "@/queries/batch-run-queries";
import { useReviewStore } from "@/stores/review-store";
import { Play, Loader2 } from "lucide-react";

export function BatchRunPanel() {
  const { activeBatchRunId, setActiveBatchRunId } = useReviewStore();
  const startMutation = useStartBatchRun();
  const { data: activeBatchRun } = useBatchRunPoll(activeBatchRunId);
  const { data: allRuns } = useBatchRuns();

  const latestRun = activeBatchRun || allRuns?.[allRuns.length - 1];
  const isRunning =
    latestRun?.status === "running" || latestRun?.status === "pending";

  const handleStart = async () => {
    try {
      const result = await startMutation.mutateAsync({});
      setActiveBatchRunId(result.batchRunId);
    } catch {
      // Error handled by mutation
    }
  };

  const progress =
    latestRun && latestRun.totalEntities > 0
      ? Math.round(
          (latestRun.completedEntities / latestRun.totalEntities) * 100
        )
      : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Batch Generation</CardTitle>
          <Button
            size="sm"
            onClick={handleStart}
            disabled={isRunning || startMutation.isPending}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Start Batch Run
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {latestRun ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge
                variant={
                  latestRun.status === "completed"
                    ? "default"
                    : latestRun.status === "failed"
                      ? "destructive"
                      : "secondary"
                }
              >
                {latestRun.status}
              </Badge>
              <span className="text-muted-foreground">
                {latestRun.completedEntities}/{latestRun.totalEntities} entities
                {" | "}
                {latestRun.completedFields}/{latestRun.totalFields} fields
              </span>
              {latestRun.failedEntities > 0 && (
                <span className="text-destructive text-xs">
                  ({latestRun.failedEntities} failed)
                </span>
              )}
            </div>

            {isRunning && (
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Run the batch generator to create AI-powered mappings for all
            unmapped fields.
          </p>
        )}

        {startMutation.isError && (
          <p className="text-sm text-destructive mt-2">
            {startMutation.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
