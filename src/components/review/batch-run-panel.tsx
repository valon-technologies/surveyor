"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBatchRunPoll, useBatchRuns } from "@/queries/batch-run-queries";
import { useReviewStore } from "@/stores/review-store";
import { Play, Loader2, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { BatchRunDialog } from "./batch-run-dialog";

/** If a run hasn't been updated in this many ms, treat it as stale */
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function isStaleRun(run: { status: string; updatedAt: string }): boolean {
  if (run.status !== "running" && run.status !== "pending") return false;
  const updatedAt = new Date(run.updatedAt).getTime();
  return Date.now() - updatedAt > STALE_THRESHOLD_MS;
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "";
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "";
  const elapsed = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export function BatchRunPanel() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [, setTick] = useState(0);
  const { activeBatchRunId } = useReviewStore();
  const { data: activeBatchRun } = useBatchRunPoll(activeBatchRunId);
  const { data: allRuns } = useBatchRuns();

  const latestRun = activeBatchRun || allRuns?.[allRuns.length - 1];
  const stale = latestRun ? isStaleRun(latestRun) : false;
  const isRunning =
    !stale &&
    (latestRun?.status === "running" || latestRun?.status === "pending");
  const isCompleted = latestRun?.status === "completed";
  const isFailed = latestRun?.status === "failed";

  // Tick every second while running to update elapsed time
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Use field-level progress for more granular tracking
  const progress =
    latestRun && latestRun.totalFields > 0
      ? Math.round(
          (latestRun.completedFields / latestRun.totalFields) * 100
        )
      : 0;

  const statusBadge = stale
    ? { variant: "destructive" as const, label: "stale" }
    : isFailed
      ? { variant: "destructive" as const, label: "failed" }
      : isCompleted
        ? { variant: "default" as const, label: "completed" }
        : latestRun?.status === "running"
          ? { variant: "secondary" as const, label: "running" }
          : { variant: "secondary" as const, label: "pending" };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Batch Generation</CardTitle>
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              disabled={isRunning}
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
              {/* Status row */}
              <div className="flex items-center gap-2 text-sm">
                <Badge variant={statusBadge.variant}>
                  {statusBadge.label}
                </Badge>
                <span className="text-muted-foreground">
                  {latestRun.completedEntities}/{latestRun.totalEntities}{" "}
                  entities
                  {" · "}
                  {latestRun.completedFields}/{latestRun.totalFields} fields
                </span>
                {latestRun.failedEntities > 0 && (
                  <span className="text-destructive text-xs">
                    ({latestRun.failedEntities} failed)
                  </span>
                )}
                <Link
                  href={`/mapping/batch-runs/${latestRun.id}`}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>

              {/* Current entity + elapsed time while running */}
              {isRunning && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">
                    {latestRun.currentEntityName
                      ? `Processing: ${latestRun.currentEntityName} (${latestRun.completedEntities + 1}/${latestRun.totalEntities})`
                      : latestRun.status === "pending"
                        ? "Preparing..."
                        : "Starting next entity..."}
                  </span>
                  {latestRun.startedAt && (
                    <span className="ml-2 shrink-0">
                      {formatElapsed(latestRun.startedAt)}
                    </span>
                  )}
                </div>
              )}

              {/* Completed summary */}
              {isCompleted && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>
                    Completed in {formatDuration(latestRun.startedAt, latestRun.completedAt)}
                  </span>
                </div>
              )}

              {/* Failed summary */}
              {isFailed && !stale && (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                  <XCircle className="h-3.5 w-3.5" />
                  <span>
                    Failed after {formatDuration(latestRun.startedAt, latestRun.completedAt)}
                  </span>
                </div>
              )}

              {stale && (
                <p className="text-xs text-destructive">
                  This run appears to have stalled. You can start a new one.
                </p>
              )}

              {/* Progress bar — visible while running AND on completion */}
              {(isRunning || isCompleted || isFailed) && (
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      isFailed
                        ? "bg-destructive"
                        : isCompleted
                          ? "bg-green-600"
                          : "bg-primary"
                    }`}
                    style={{ width: `${isCompleted ? 100 : progress}%` }}
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
        </CardContent>
      </Card>

      {dialogOpen && <BatchRunDialog onClose={() => setDialogOpen(false)} />}
    </>
  );
}
