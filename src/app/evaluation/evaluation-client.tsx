"use client";

import { useState, useMemo } from "react";
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

type MilestoneFilter = "all" | "m1" | "m2";

export function EvaluationClient() {
  const { data, isLoading } = useSotEvaluations();
  const runEval = useRunSotEvaluation();
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);
  const { data: detail } = useSotEvaluationDetail(selectedEvalId);
  const [milestoneFilter, setMilestoneFilter] = useState<MilestoneFilter>("all");

  // Deduplicate: latest eval per entity
  const latestByEntity = useMemo(() => {
    const map = new Map<string, SotEvaluationSummary>();
    for (const ev of data?.evaluations ?? []) {
      if (!map.has(ev.entityId)) map.set(ev.entityId, ev);
    }
    return map;
  }, [data?.evaluations]);

  // Filter by milestone
  const milestoneMap = data?.milestoneMap ?? {};
  const latestEvaluations = useMemo(() => {
    const all = Array.from(latestByEntity.values());
    if (milestoneFilter === "all") return all;
    return all.filter((ev) => {
      const name = ev.entityName;
      if (!name) return false;
      return milestoneMap[name]?.includes(milestoneFilter);
    });
  }, [latestByEntity, milestoneFilter, milestoneMap]);

  // Compute aggregate stats from filtered evaluations
  const stats = useMemo(() => {
    let totalScored = 0;
    let totalSrcExact = 0;
    let totalSrcLenient = 0;
    let totalTxfmExact = 0;
    let totalTxfmLenient = 0;
    let txfmEntities = 0;

    for (const ev of latestEvaluations) {
      totalScored += ev.scoredFields;
      totalSrcExact += ev.sourceExactCount;
      totalSrcLenient += ev.sourceLenientCount;
      if (ev.transformExactCount != null) {
        totalTxfmExact += ev.transformExactCount;
        totalTxfmLenient += ev.transformLenientCount!;
        txfmEntities++;
      }
    }

    return {
      entities: latestEvaluations.length,
      totalScored,
      totalSrcExact,
      totalSrcLenient,
      totalTxfmExact,
      totalTxfmLenient,
      hasTxfm: txfmEntities > 0,
    };
  }, [latestEvaluations]);

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

  const availableCount = data?.availableEntities?.length ?? 0;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            SOT Accuracy
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generated mappings vs ground truth ({availableCount} entities with SOT data)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* M1/M2 filter */}
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5">
            {(["all", "m1", "m2"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => { setMilestoneFilter(opt); setSelectedEvalId(null); }}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  milestoneFilter === opt
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt === "all" ? "All" : opt.toUpperCase()}
              </button>
            ))}
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
      </div>

      {/* Run result toast */}
      {runEval.data && (
        <div className="rounded-lg border bg-muted/50 px-4 py-3 text-sm">
          {runEval.data.message}
        </div>
      )}

      {/* 4 Accuracy Metric Cards */}
      {stats.entities > 0 && (
        <div className={cn("grid gap-4", stats.hasTxfm ? "grid-cols-2 md:grid-cols-4 lg:grid-cols-6" : "grid-cols-2 md:grid-cols-4")}>
          <StatCard
            label="Entities"
            value={String(stats.entities)}
          />
          <StatCard
            label="Scored Fields"
            value={String(stats.totalScored)}
          />
          <StatCard
            label="Source Exact"
            value={stats.totalScored > 0
              ? `${((stats.totalSrcExact / stats.totalScored) * 100).toFixed(1)}%`
              : "\u2014"
            }
            sub={`${stats.totalSrcExact} / ${stats.totalScored}`}
          />
          <StatCard
            label="Source Lenient"
            value={stats.totalScored > 0
              ? `${((stats.totalSrcLenient / stats.totalScored) * 100).toFixed(1)}%`
              : "\u2014"
            }
            sub={`${stats.totalSrcLenient} / ${stats.totalScored}`}
          />
          {stats.hasTxfm && (
            <>
              <StatCard
                label="Transform Exact"
                value={stats.totalScored > 0
                  ? `${((stats.totalTxfmExact / stats.totalScored) * 100).toFixed(1)}%`
                  : "\u2014"
                }
                sub={`${stats.totalTxfmExact} / ${stats.totalScored}`}
              />
              <StatCard
                label="Transform Lenient"
                value={stats.totalScored > 0
                  ? `${((stats.totalTxfmLenient / stats.totalScored) * 100).toFixed(1)}%`
                  : "\u2014"
                }
                sub={`${stats.totalTxfmLenient} / ${stats.totalScored}`}
              />
            </>
          )}
        </div>
      )}

      {/* Entity results table */}
      {latestEvaluations.length > 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2.5 font-medium">Entity</th>
                  <th className="text-right px-4 py-2.5 font-medium w-16">Scored</th>
                  <th className="text-right px-4 py-2.5 font-medium w-28">Src Exact</th>
                  <th className="text-right px-4 py-2.5 font-medium w-28">Src Lenient</th>
                  {stats.hasTxfm && (
                    <>
                      <th className="text-right px-4 py-2.5 font-medium w-28">Txfm Exact</th>
                      <th className="text-right px-4 py-2.5 font-medium w-28">Txfm Lenient</th>
                    </>
                  )}
                  <th className="text-right px-4 py-2.5 font-medium w-28">Evaluated</th>
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
                      {ev.entityName && milestoneMap[ev.entityName] && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {milestoneMap[ev.entityName].map((m) => m.toUpperCase()).join("+")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs">
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
                    </td>
                    {stats.hasTxfm && (
                      <>
                        <td className="px-4 py-2.5 text-right">
                          {ev.transformExactPct != null ? (
                            <>
                              <AccuracyBadge pct={ev.transformExactPct} size="md" />
                              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                                {ev.transformExactCount}/{ev.scoredFields}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">\u2014</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {ev.transformLenientPct != null ? (
                            <AccuracyBadge pct={ev.transformLenientPct} size="md" />
                          ) : (
                            <span className="text-xs text-muted-foreground">\u2014</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {new Date(ev.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No evaluations yet. Click &ldquo;Run Evaluation&rdquo; to compare generated
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
