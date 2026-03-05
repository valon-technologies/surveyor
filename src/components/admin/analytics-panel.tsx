"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { cn } from "@/lib/utils";
import { MILESTONES } from "@/lib/constants";

interface AnalyticsData {
  period: { days: number; since: string };
  milestone: string | null;
  reviewEfficiency: {
    totalStarted: number;
    totalCompleted: number;
    totalAbandoned: number;
    completionRate: number;
    avgDurationMs: number;
    medianDurationMs: number;
    p90DurationMs: number;
  };
  aiValue: {
    suggestionsAccepted: number;
    suggestionsOverridden: number;
    acceptanceRate: number;
    chatMessagesSent: number;
    chatChangedMind: number;
    chatInfluenceRate: number;
  };
  qualityAndLearning: {
    whyWrongProvided: number;
    whyWrongRate: number;
    topReviewers: { userId: string; name: string; reviewCount: number }[];
  };
  dailyTrend: { date: string; event: string; count: number }[];
  perUser: {
    userId: string; name: string;
    reviewed: number; started: number; abandoned: number;
    accepted: number; overridden: number; whyWrong: number;
    chatSent: number; chatChanged: number;
    avgDurationMs: number; medianDurationMs: number;
  }[];
  eventCounts: Record<string, number>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remaining = secs % 60;
  return remaining > 0 ? `${mins}m ${remaining}s` : `${mins}m`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border rounded-lg p-3 bg-background">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function BarChart({ data, maxVal }: { data: { label: string; value: number; color: string }[]; maxVal: number }) {
  if (maxVal === 0) return <div className="text-xs text-muted-foreground">No data yet</div>;
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-20 shrink-0 text-right">{d.label}</span>
          <div className="flex-1 h-5 bg-muted/50 rounded overflow-hidden">
            <div
              className={cn("h-full rounded transition-all", d.color)}
              style={{ width: `${Math.max((d.value / maxVal) * 100, d.value > 0 ? 2 : 0)}%` }}
            />
          </div>
          <span className="text-xs font-medium w-8 text-right">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

function DailyTrendChart({ trend }: { trend: AnalyticsData["dailyTrend"] }) {
  // Aggregate by date for key events
  const dateMap = new Map<string, { submitted: number; started: number; chatSent: number }>();
  for (const item of trend) {
    const existing = dateMap.get(item.date) || { submitted: 0, started: 0, chatSent: 0 };
    if (item.event === "review_submitted") existing.submitted += item.count;
    if (item.event === "review_started") existing.started += item.count;
    if (item.event === "ai_chat_sent") existing.chatSent += item.count;
    dateMap.set(item.date, existing);
  }

  const entries = Array.from(dateMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <div className="text-xs text-muted-foreground">No data yet</div>;

  const maxVal = Math.max(...entries.map(([, v]) => Math.max(v.submitted, v.started, v.chatSent)), 1);

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-px min-w-fit" style={{ height: 120 }}>
        {entries.map(([date, vals]) => (
          <div key={date} className="flex flex-col items-center gap-px" style={{ minWidth: 24 }}>
            <div className="flex items-end gap-px" style={{ height: 100 }}>
              <div
                className="w-2 bg-blue-400 rounded-t"
                style={{ height: `${(vals.started / maxVal) * 100}%`, minHeight: vals.started > 0 ? 2 : 0 }}
                title={`Started: ${vals.started}`}
              />
              <div
                className="w-2 bg-green-500 rounded-t"
                style={{ height: `${(vals.submitted / maxVal) * 100}%`, minHeight: vals.submitted > 0 ? 2 : 0 }}
                title={`Submitted: ${vals.submitted}`}
              />
              <div
                className="w-2 bg-purple-400 rounded-t"
                style={{ height: `${(vals.chatSent / maxVal) * 100}%`, minHeight: vals.chatSent > 0 ? 2 : 0 }}
                title={`Chat: ${vals.chatSent}`}
              />
            </div>
            <span className="text-[8px] text-muted-foreground rotate-[-45deg] origin-top-left whitespace-nowrap mt-1">
              {date.slice(5)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-400" /> Started</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500" /> Submitted</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-purple-400" /> Chat</span>
      </div>
    </div>
  );
}

export function AnalyticsPanel() {
  const { workspaceId } = useWorkspace();
  const [days, setDays] = useState(30);
  const [milestone, setMilestone] = useState<string | undefined>(undefined);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", workspaceId, days, milestone],
    queryFn: () =>
      api.get<AnalyticsData>(workspacePath(workspaceId, "analytics"), { days, milestone }),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading analytics...</p>;
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">No analytics data available.</p>;
  }

  const { reviewEfficiency: re, aiValue: ai, qualityAndLearning: ql } = data;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Period:</span>
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                days === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Milestone:</span>
          <button
            onClick={() => setMilestone(undefined)}
            className={cn(
              "px-2 py-0.5 text-xs rounded transition-colors",
              !milestone
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            All
          </button>
          {MILESTONES.map((m) => (
            <button
              key={m}
              onClick={() => setMilestone(m)}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                milestone === m
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Section: Review Efficiency */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Review Efficiency</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Reviews Completed" value={re.totalCompleted} />
          <StatCard label="Completion Rate" value={`${re.completionRate}%`} sub={`${re.totalStarted} started, ${re.totalAbandoned} abandoned`} />
          <StatCard label="Median Duration" value={formatDuration(re.medianDurationMs)} sub={`avg ${formatDuration(re.avgDurationMs)}`} />
          <StatCard label="P90 Duration" value={formatDuration(re.p90DurationMs)} />
        </div>
        <div className="border rounded-lg p-3 bg-background">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Daily Activity</div>
          <DailyTrendChart trend={data.dailyTrend} />
        </div>
      </section>

      {/* Section: AI Value */}
      <section>
        <h3 className="text-sm font-semibold mb-3">AI Value</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="AI Acceptance Rate" value={`${ai.acceptanceRate}%`} sub={`${ai.suggestionsAccepted} accepted / ${ai.suggestionsOverridden} overridden`} />
          <StatCard label="Chat Messages" value={ai.chatMessagesSent} />
          <StatCard label="Chat Changed Mind" value={ai.chatChangedMind} sub={`${ai.chatInfluenceRate}% of chats`} />
          <StatCard label="Suggestions Total" value={ai.suggestionsAccepted + ai.suggestionsOverridden} />
        </div>
        <div className="border rounded-lg p-3 bg-background">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">AI Suggestions Breakdown</div>
          <BarChart
            data={[
              { label: "Accepted", value: ai.suggestionsAccepted, color: "bg-green-500" },
              { label: "Overridden", value: ai.suggestionsOverridden, color: "bg-amber-500" },
              { label: "Chat Sent", value: ai.chatMessagesSent, color: "bg-purple-400" },
              { label: "Mind Changed", value: ai.chatChangedMind, color: "bg-blue-400" },
            ]}
            maxVal={Math.max(ai.suggestionsAccepted, ai.suggestionsOverridden, ai.chatMessagesSent, 1)}
          />
        </div>
      </section>

      {/* Section: Quality & Learning Curve */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Quality & Learning Curve</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <StatCard label="'Why Wrong' Provided" value={ql.whyWrongProvided} sub={`${ql.whyWrongRate}% of overrides`} />
          <StatCard label="Total Events" value={Object.values(data.eventCounts).reduce((a, b) => a + b, 0)} />
        </div>

        {ql.topReviewers.length > 0 && (
          <div className="border rounded-lg p-3 bg-background">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Top Reviewers</div>
            <div className="space-y-1">
              {ql.topReviewers.map((r, i) => (
                <div key={r.userId} className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-right text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 font-medium">{r.name}</span>
                  <span className="text-muted-foreground">{r.reviewCount} reviews</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section: Per-User Breakdown */}
      {data.perUser.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-3">Reviewer Breakdown</h3>
          <div className="border rounded-lg bg-background overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Reviewer</th>
                  <th className="text-right px-2 py-2">Reviewed</th>
                  <th className="text-right px-2 py-2">Median Time</th>
                  <th className="text-right px-2 py-2">AI Accept</th>
                  <th className="text-right px-2 py-2">AI Override</th>
                  <th className="text-right px-2 py-2">Why Wrong</th>
                  <th className="text-right px-2 py-2">Chat Msgs</th>
                  <th className="text-right px-2 py-2">Chat Influenced</th>
                  <th className="text-right px-2 py-2">Completion %</th>
                </tr>
              </thead>
              <tbody>
                {data.perUser.map((u) => {
                  const acceptRate = u.accepted + u.overridden > 0
                    ? Math.round((u.accepted / (u.accepted + u.overridden)) * 100)
                    : null;
                  const completionRate = u.started > 0
                    ? Math.round((u.reviewed / u.started) * 100)
                    : null;
                  return (
                    <tr key={u.userId} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{u.name}</td>
                      <td className="text-right px-2 py-2">{u.reviewed}</td>
                      <td className="text-right px-2 py-2 text-muted-foreground">{u.medianDurationMs > 0 ? formatDuration(u.medianDurationMs) : "-"}</td>
                      <td className="text-right px-2 py-2 text-green-600">{u.accepted || "-"}</td>
                      <td className="text-right px-2 py-2 text-amber-600">{u.overridden || "-"}</td>
                      <td className="text-right px-2 py-2">{u.whyWrong || "-"}</td>
                      <td className="text-right px-2 py-2">{u.chatSent || "-"}</td>
                      <td className="text-right px-2 py-2">{u.chatChanged || "-"}</td>
                      <td className="text-right px-2 py-2">{completionRate !== null ? `${completionRate}%` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
