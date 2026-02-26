"use client";

import { useState } from "react";
import {
  useSotEvaluations,
  useSotEvaluationDetail,
  useRunSotEvaluation,
  type SotEvaluationSummary,
} from "@/queries/sot-evaluation-queries";
import { AccuracyBadge } from "@/components/evaluation/accuracy-badge";
import { FieldEvalView } from "@/components/evaluation/field-eval-view";
import { FeedbackTrail } from "@/components/evaluation/feedback-trail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function EvaluationClient() {
  const { data, isLoading } = useSotEvaluations();
  const runEval = useRunSotEvaluation();
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);
  const { data: detail } = useSotEvaluationDetail(selectedEvalId);

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-7 bg-muted rounded w-48" />
          <div className="h-32 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const evaluations = data?.evaluations ?? [];
  const stats = data?.stats;
  const availableCount = data?.availableEntities?.length ?? 0;

  // Deduplicate: show only the latest evaluation per entity
  const latestByEntity = new Map<string, SotEvaluationSummary>();
  for (const ev of evaluations) {
    if (!latestByEntity.has(ev.entityId)) {
      latestByEntity.set(ev.entityId, ev);
    }
  }
  const latestEvaluations = Array.from(latestByEntity.values());

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            SOT Accuracy
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Source accuracy of generated mappings vs ground truth ({availableCount} entities with SOT data)
          </p>
        </div>
        <button
          onClick={() => runEval.mutate(undefined)}
          disabled={runEval.isPending}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {runEval.isPending ? "Evaluating..." : "Run Evaluation"}
        </button>
      </div>

      {/* Run result toast */}
      {runEval.data && (
        <div className="rounded-lg border bg-muted/50 px-4 py-3 text-sm">
          {runEval.data.message}
        </div>
      )}

      {/* Aggregate stats */}
      {stats && stats.totalEvaluations > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Entities Evaluated"
            value={String(latestEvaluations.length)}
          />
          <StatCard
            label="Scored Fields"
            value={String(stats.totalScoredFields)}
          />
          <StatCard
            label="Source Exact"
            value={
              stats.totalScoredFields > 0
                ? `${((stats.totalExact / stats.totalScoredFields) * 100).toFixed(1)}%`
                : "—"
            }
            sub={`${stats.totalExact} / ${stats.totalScoredFields}`}
          />
          <StatCard
            label="Source Lenient"
            value={
              stats.totalScoredFields > 0
                ? `${((stats.totalLenient / stats.totalScoredFields) * 100).toFixed(1)}%`
                : "—"
            }
            sub={`${stats.totalLenient} / ${stats.totalScoredFields}`}
          />
        </div>
      )}

      {/* Entity results table */}
      {latestEvaluations.length > 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-4 py-2.5 font-medium">Entity</th>
                <th className="text-right px-4 py-2.5 font-medium w-20">Scored</th>
                <th className="text-right px-4 py-2.5 font-medium w-28">Exact</th>
                <th className="text-right px-4 py-2.5 font-medium w-28">Lenient</th>
                <th className="text-right px-4 py-2.5 font-medium w-36">Evaluated</th>
              </tr>
            </thead>
            <tbody>
              {latestEvaluations.map((ev) => (
                <tr
                  key={ev.id}
                  onClick={() =>
                    setSelectedEvalId(selectedEvalId === ev.id ? null : ev.id)
                  }
                  className={cn(
                    "border-b last:border-0 cursor-pointer transition-colors",
                    selectedEvalId === ev.id
                      ? "bg-primary/5"
                      : "hover:bg-muted/30",
                  )}
                >
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {ev.entityName ?? ev.entityId}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {ev.scoredFields}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <AccuracyBadge pct={ev.sourceExactPct} size="md" />
                    <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                      {ev.sourceExactCount}/{ev.scoredFields}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <AccuracyBadge pct={ev.sourceLenientPct} size="md" />
                    <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                      {ev.sourceLenientCount}/{ev.scoredFields}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {new Date(ev.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No evaluations yet. Click "Run Evaluation" to compare generated
            mappings against SOT ground truth.
          </CardContent>
        </Card>
      )}

      {/* Detail panel */}
      {selectedEvalId && detail?.fieldResults && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            {detail.entityName} — Per-Field Results
          </h2>
          <FieldEvalView fieldResults={detail.fieldResults} />
        </div>
      )}

      {/* Feedback Trail */}
      {selectedEvalId && detail && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            Feedback Trail
          </h2>
          <p className="text-sm text-muted-foreground">
            Pipeline events showing how reviewer feedback flows through learning extraction, Entity Knowledge rebuilds, context assembly, and SOT evaluation.
          </p>
          <FeedbackTrail entityId={detail.entityId} />
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && (
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}
