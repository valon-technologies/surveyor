"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Check, X, ChevronDown, Trash2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMappingStore } from "@/stores/mapping-store";
import {
  useGenerationQueueStore,
  selectRunningCount,
  type QueuedGeneration,
} from "@/stores/generation-queue-store";

export function GenerationQueue() {
  const queue = useGenerationQueueStore((s) => s.queue);
  const runningCount = useGenerationQueueStore(selectRunningCount);
  const clearCompleted = useGenerationQueueStore((s) => s.clearCompleted);
  const [expanded, setExpanded] = useState(false);

  // Don't render if queue is empty
  if (queue.length === 0) return null;

  const completedOrFailed = queue.filter((g) => g.status !== "running");

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Collapsed pill */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium shadow-lg transition-all",
          "bg-background/95 backdrop-blur-sm hover:shadow-xl",
          runningCount > 0
            ? "border-purple-300 dark:border-purple-700"
            : "border-border"
        )}
      >
        <span className="relative">
          <Sparkles className={cn(
            "h-4 w-4",
            runningCount > 0 ? "text-purple-500" : "text-muted-foreground"
          )} />
          {runningCount > 0 && (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
          )}
        </span>
        <span className={cn(
          runningCount > 0 ? "text-purple-700 dark:text-purple-300" : "text-muted-foreground"
        )}>
          {runningCount > 0 ? `${runningCount} running` : `${queue.length} done`}
        </span>
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-muted-foreground transition-transform",
          expanded && "rotate-180"
        )} />
      </button>

      {/* Expanded dropdown */}
      {expanded && (
        <div className="absolute right-0 bottom-full mb-2 w-80 rounded-lg border bg-background/95 backdrop-blur-sm shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Generation Queue
            </span>
            {completedOrFailed.length > 0 && (
              <button
                onClick={clearCompleted}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y">
            {queue.map((item) => (
              <QueueItem
                key={item.generationId}
                item={item}
                onNavigate={() => setExpanded(false)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QueueItem({ item, onNavigate }: { item: QueuedGeneration; onNavigate: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const router = useRouter();
  const setAutoMapSheetOpen = useMappingStore((s) => s.setAutoMapSheetOpen);
  const setReviewGenerationId = useMappingStore((s) => s.setReviewGenerationId);

  useEffect(() => {
    if (item.status !== "running") return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - item.startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [item.status, item.startedAt]);

  const duration = item.status === "running"
    ? elapsed
    : (item.completedAt || Date.now()) - item.startedAt;

  const handleClick = () => {
    onNavigate();
    setReviewGenerationId(item.generationId);
    setAutoMapSheetOpen(true);
    router.push(`/mapping/${item.entityId}`);
  };

  return (
    <button
      onClick={handleClick}
      className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-muted/50 cursor-pointer"
    >
      {/* Status icon */}
      {item.status === "running" && (
        <Loader2 className="h-4 w-4 animate-spin text-purple-500 shrink-0" />
      )}
      {item.status === "completed" && (
        <Check className="h-4 w-4 text-green-500 shrink-0" />
      )}
      {item.status === "failed" && (
        <X className="h-4 w-4 text-red-500 shrink-0" />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{item.entityName}</p>
        <p className="text-[11px] text-muted-foreground">
          {item.fieldCount} field{item.fieldCount !== 1 ? "s" : ""}
          {" \u00b7 "}
          {formatDuration(duration)}
          {item.status === "completed" && item.parsedOutput && (
            <> &middot; {item.parsedOutput.fieldMappings.length} suggestions</>
          )}
        </p>
        {item.status === "failed" && item.error && (
          <p className="text-[11px] text-red-500 dark:text-red-400 truncate mt-0.5">
            {item.error}
          </p>
        )}
      </div>

      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </button>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
