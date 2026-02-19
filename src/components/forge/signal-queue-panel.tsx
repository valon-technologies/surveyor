"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSignalQueue, useTriggerRefresh } from "@/queries/signal-queries";
import { Activity, RefreshCw, Zap } from "lucide-react";

export function SignalQueuePanel() {
  const { data: queue, isLoading } = useSignalQueue();
  const triggerRefresh = useTriggerRefresh();

  if (isLoading) {
    return (
      <div className="border rounded-lg p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-muted rounded w-32" />
          <div className="h-4 bg-muted rounded w-48" />
        </div>
      </div>
    );
  }

  if (!queue || queue.length === 0) {
    return (
      <div className="border rounded-lg p-4 text-center text-muted-foreground">
        <Activity className="h-5 w-5 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No pending signals</p>
      </div>
    );
  }

  const readyForRefresh = queue.filter((q) => q.shouldRefresh);
  const pending = queue.filter((q) => !q.shouldRefresh);

  return (
    <div className="space-y-3">
      {readyForRefresh.length > 0 && (
        <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-4 bg-amber-50/50 dark:bg-amber-950/20">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-600" />
            Ready for Refresh ({readyForRefresh.length})
          </h3>
          <div className="space-y-2">
            {readyForRefresh.map((entry) => (
              <SignalQueueRow
                key={entry.entityId}
                entry={entry}
                onRefresh={() =>
                  triggerRefresh.mutate({ entityId: entry.entityId })
                }
                isRefreshing={triggerRefresh.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-2 text-muted-foreground">
            Accumulating Signals ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((entry) => (
              <SignalQueueRow key={entry.entityId} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SignalQueueRow({
  entry,
  onRefresh,
  isRefreshing,
}: {
  entry: {
    entityId: string;
    entityName: string;
    score: number;
    signalCount: number;
    latestSignal: string;
    shouldRefresh: boolean;
  };
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const dateLabel = entry.latestSignal
    ? new Date(entry.latestSignal).toLocaleDateString()
    : "";

  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">
          {entry.entityName}
        </span>
        <Badge variant="secondary" className="text-xs shrink-0">
          {entry.signalCount} signal{entry.signalCount !== 1 ? "s" : ""}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0">
          score: {entry.score}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {dateLabel && (
          <span className="text-xs text-muted-foreground">{dateLabel}</span>
        )}
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-3 w-3 mr-1 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
}
