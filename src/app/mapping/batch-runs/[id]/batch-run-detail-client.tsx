"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import {
  useBatchRunSessions,
  type BatchRunSession,
  type BatchRunEntityResult,
  type BatchRunFieldMapping,
} from "@/queries/batch-run-queries";
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  Wrench,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

interface Props {
  batchRunId: string;
}

export function BatchRunDetailClient({ batchRunId }: Props) {
  const { data, isLoading } = useBatchRunSessions(batchRunId);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const prevActiveRef = useRef<string | null>(null);

  const sessions = data?.sessions ?? [];
  const entityResults = data?.entityResults ?? [];
  const mode = data?.mode ?? "single-shot";
  const run = data?.batchRun;

  // Auto-expand the currently active session (chat mode)
  useEffect(() => {
    if (mode !== "chat") return;
    const active = sessions.find((s) => s.status === "active");
    if (active && active.id !== prevActiveRef.current) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (prevActiveRef.current) next.delete(prevActiveRef.current);
        next.add(active.id);
        return next;
      });
      prevActiveRef.current = active.id;
    }
  }, [sessions, mode]);

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusBadgeVariant = !run
    ? ("secondary" as const)
    : run.status === "completed"
      ? ("default" as const)
      : run.status === "failed"
        ? ("destructive" as const)
        : ("secondary" as const);

  const runFinished = run?.status === "completed" || run?.status === "failed";

  // Stats differ by mode
  const isSingleShot = mode === "single-shot";
  const completedEntities = isSingleShot
    ? entityResults.filter((e) => e.status === "completed").length
    : 0;
  const totalEntities = isSingleShot ? entityResults.length : 0;
  const totalFields = isSingleShot
    ? entityResults.reduce((sum, e) => sum + e.fieldCount, 0)
    : sessions.length;
  const completedSessionCount = sessions.filter(
    (s) => s.status === "resolved" || s.status === "abandoned"
  ).length;
  const activeCount = runFinished
    ? 0
    : isSingleShot
      ? entityResults.filter((e) => e.status === "running").length
      : sessions.filter((s) => s.status === "active").length;

  const isEmpty = isSingleShot
    ? entityResults.length === 0
    : sessions.length === 0;

  const progressNumerator = isSingleShot ? completedEntities : completedSessionCount;
  const progressDenominator = isSingleShot ? totalEntities : sessions.length;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/mapping"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold">Batch Run</h1>
        {run && (
          <>
            <span className="text-muted-foreground text-sm">
              {isSingleShot
                ? `${completedEntities}/${totalEntities} entities, ${totalFields} fields`
                : `${completedSessionCount}/${sessions.length} fields`}
            </span>
            <Badge variant={statusBadgeVariant}>{run.status}</Badge>
            {activeCount > 0 && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </>
        )}
      </div>

      {/* Progress bar */}
      {run &&
        (run.status === "running" || run.status === "pending") &&
        progressDenominator > 0 && (
          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-500"
              style={{
                width: `${Math.round((progressNumerator / Math.max(progressDenominator, 1)) * 100)}%`,
              }}
            />
          </div>
        )}

      {/* Empty state */}
      {isEmpty && !isLoading && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {runFinished
            ? "No results found for this batch run."
            : "Waiting for the batch run to start processing..."}
        </p>
      )}

      {/* Single-shot entity results */}
      {isSingleShot && (
        <div className="space-y-1">
          {entityResults.map((result) => (
            <EntityResultRow
              key={result.generationId}
              result={result}
              expanded={expandedIds.has(result.generationId)}
              onToggle={() => toggle(result.generationId)}
            />
          ))}
        </div>
      )}

      {/* Chat session results */}
      {!isSingleShot && (
        <div className="space-y-1">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              expanded={expandedIds.has(session.id)}
              onToggle={() => toggle(session.id)}
              runFinished={runFinished}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Single-shot: Entity Result Row ─── */

function EntityResultRow({
  result,
  expanded,
  onToggle,
}: {
  result: BatchRunEntityResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isCompleted = result.status === "completed";
  const isFailed = result.status === "failed";
  const isRunning = result.status === "running";

  // Confidence breakdown
  const confidenceCounts = result.fieldMappings.reduce(
    (acc, m) => {
      if (m.confidence === "high") acc.high++;
      else if (m.confidence === "medium") acc.medium++;
      else if (m.confidence === "low") acc.low++;
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );

  return (
    <div
      className={cn(
        "rounded-lg border",
        isRunning && "border-primary/40 bg-primary/5",
        isFailed && "border-red-300 dark:border-red-800",
        !isRunning && !isFailed && "border-border"
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors rounded-lg"
      >
        {/* Status icon */}
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
        ) : isCompleted ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
        ) : isFailed ? (
          <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}

        {/* Entity name */}
        <span className="font-medium truncate">{result.entityName}</span>

        {/* Field count */}
        <span className="text-xs text-muted-foreground">
          {result.fieldCount} fields
        </span>

        {/* Confidence breakdown (when completed) */}
        {isCompleted && result.fieldCount > 0 && (
          <span className="hidden sm:flex items-center gap-1 text-xs">
            {confidenceCounts.high > 0 && (
              <span className="text-green-600">{confidenceCounts.high}H</span>
            )}
            {confidenceCounts.medium > 0 && (
              <span className="text-amber-600">{confidenceCounts.medium}M</span>
            )}
            {confidenceCounts.low > 0 && (
              <span className="text-red-600">{confidenceCounts.low}L</span>
            )}
          </span>
        )}

        {/* Token usage + duration */}
        {isCompleted && (
          <span className="hidden sm:inline text-xs text-muted-foreground">
            {result.inputTokens != null &&
              result.outputTokens != null &&
              `${((result.inputTokens + result.outputTokens) / 1000).toFixed(1)}k tok`}
            {result.durationMs != null && ` / ${(result.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Validation score */}
        {result.validationScore != null && (
          <Badge
            variant={result.validationScore >= 80 ? "default" : result.validationScore >= 50 ? "secondary" : "destructive"}
            className="text-[10px] px-1.5 py-0"
          >
            {result.validationScore}%
          </Badge>
        )}

        <div className="ml-auto shrink-0">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded: field mapping table */}
      {expanded && (
        <div className="border-t px-3 py-2 space-y-1">
          {isFailed && result.error && (
            <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1.5 mb-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{result.error}</span>
            </div>
          )}
          {result.fieldMappings.length === 0 && !isFailed && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No field mappings generated
            </p>
          )}
          {result.fieldMappings.length > 0 && (
            <div className="divide-y">
              {result.fieldMappings.map((fm, i) => (
                <FieldMappingRow key={i} mapping={fm} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Single-shot: Field Mapping Row ─── */

function FieldMappingRow({ mapping }: { mapping: BatchRunFieldMapping }) {
  const [showReasoning, setShowReasoning] = useState(false);

  const confidenceColor =
    mapping.confidence === "high"
      ? "text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-950/30"
      : mapping.confidence === "medium"
        ? "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/30"
        : mapping.confidence === "low"
          ? "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/30"
          : "text-muted-foreground bg-muted";

  const sourceExpression = mapping.transform
    || mapping.sourceFieldName
    || null;

  return (
    <div className="py-1.5 text-xs">
      <div className="flex items-center gap-2">
        {/* Target field */}
        <span className="font-mono font-medium min-w-0 truncate">
          {mapping.targetFieldName}
        </span>

        {/* Mapping type badge */}
        {mapping.mappingType && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
            {mapping.mappingType}
          </Badge>
        )}

        {/* Confidence badge */}
        {mapping.confidence && (
          <span
            className={cn(
              "text-[10px] px-1.5 py-0 rounded-full font-medium shrink-0",
              confidenceColor
            )}
          >
            {mapping.confidence}
          </span>
        )}

        {/* Source expression */}
        {sourceExpression && (
          <span className="text-muted-foreground truncate ml-auto font-mono">
            {mapping.sourceEntityName
              ? `${mapping.sourceEntityName}.${sourceExpression}`
              : sourceExpression}
          </span>
        )}

        {/* Reasoning toggle */}
        {mapping.reasoning && (
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="text-muted-foreground hover:text-foreground shrink-0 ml-1"
            title="Toggle reasoning"
          >
            {showReasoning ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {/* Reasoning detail */}
      {showReasoning && mapping.reasoning && (
        <div className="mt-1 ml-2 text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 whitespace-pre-wrap">
          {mapping.reasoning}
        </div>
      )}
    </div>
  );
}

/* ─── Chat mode: Session Row (unchanged) ─── */

function SessionRow({
  session,
  expanded,
  onToggle,
  runFinished,
}: {
  session: BatchRunSession;
  expanded: boolean;
  onToggle: () => void;
  runFinished: boolean;
}) {
  const isActive = !runFinished && session.status === "active";
  const isResolved = session.status === "resolved";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && isActive) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expanded, isActive, session.messages.length]);

  return (
    <div
      className={cn(
        "rounded-lg border",
        isActive && "border-primary/40 bg-primary/5",
        !isActive && "border-border"
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors rounded-lg"
      >
        {isActive ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
        ) : isResolved ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
        ) : session.status === "abandoned" ? (
          <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}

        <span className="font-medium truncate">
          {session.fieldName || "Unknown field"}
        </span>

        {!isActive && session.mappingSummary && (
          <span className="text-xs text-muted-foreground truncate">
            {session.mappingSummary.mappingType || "unmapped"}
            {session.mappingSummary.confidence &&
              ` (${session.mappingSummary.confidence})`}
          </span>
        )}

        {isActive && (
          <span className="text-xs text-muted-foreground">
            {session.messages.length} messages
          </span>
        )}

        <div className="ml-auto shrink-0">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-3 py-3 space-y-3 max-h-[500px] overflow-y-auto">
          {session.messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No messages yet
            </p>
          )}
          {session.messages.map((msg) => (
            <SessionMessage key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function SessionMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const toolCalls = message.metadata?.toolCalls;
  const mappingUpdate = message.metadata?.mappingUpdate;

  return (
    <div className="space-y-2">
      {toolCalls && toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {toolCalls.map((tc, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
                tc.success
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                  : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
              )}
            >
              <Wrench className="h-2.5 w-2.5" />
              {tc.name}
              {tc.success ? (
                <CheckCircle2 className="h-2.5 w-2.5" />
              ) : (
                <XCircle className="h-2.5 w-2.5" />
              )}
              {tc.durationMs != null && (
                <span className="opacity-70">
                  {(tc.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
        <div
          className={cn(
            "text-xs font-medium w-5 h-5 rounded-full flex items-center justify-center shrink-0",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary"
          )}
        >
          {isUser ? "U" : "A"}
        </div>
        <div
          className={cn(
            "max-w-[85%] rounded-lg px-3 py-2 text-sm",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap text-xs">{message.content}</span>
          ) : (
            <article className="prose prose-sm prose-neutral max-w-none text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>

      {mappingUpdate && Object.keys(mappingUpdate).length > 0 && (
        <MappingUpdateCard update={mappingUpdate} />
      )}
    </div>
  );
}

function MappingUpdateCard({ update }: { update: Record<string, unknown> }) {
  return (
    <div className="ml-7 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
      <div className="text-xs font-medium text-green-800 dark:text-green-300 mb-1">
        Mapping Update
      </div>
      <pre className="text-xs text-green-900 dark:text-green-200 whitespace-pre-wrap font-mono overflow-x-auto">
        {formatMappingUpdate(update)}
      </pre>
    </div>
  );
}

function formatMappingUpdate(update: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(update)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${k}: ${String(v)}`);
      }
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines.join("\n");
}
