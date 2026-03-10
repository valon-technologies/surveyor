"use client";

import type { DashboardStats } from "@/types/dashboard";

interface CompactStatsRowProps {
  stats: DashboardStats;
  milestone?: string;
  milestoneFilter?: string;
  onMilestoneChange?: (value: string) => void;
  milestoneOptions?: string[];
}

export function CompactStatsRow({
  stats,
  milestone,
  milestoneFilter,
  onMilestoneChange,
  milestoneOptions,
}: CompactStatsRowProps) {
  const fieldLabel = milestone ? `${milestone} Fields` : "Fields";
  const coverage = Number(stats.coveragePercent).toFixed(2);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-muted/50 px-4 py-2.5 text-sm">
      {milestoneOptions && onMilestoneChange && (
        <>
          <select
            value={milestoneFilter}
            onChange={(e) => onMilestoneChange(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {milestoneOptions.map((m) => (
              <option key={m} value={m}>
                {m === "All" ? "All Milestones" : m}
              </option>
            ))}
          </select>
          <Sep />
        </>
      )}
      <Stat label="Entities" value={stats.totalEntities.toLocaleString()} />
      <Sep />
      <Stat label={fieldLabel} value={stats.totalFields.toLocaleString()} />
      <Sep />
      <Stat
        label="Coverage"
        value={`${coverage}%`}
        sub={`${stats.mappedFields.toLocaleString()}/${stats.totalFields.toLocaleString()}`}
      />
      <Sep />
      <Stat label="Open Questions" value={String(stats.openQuestions)} />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-semibold tabular-nums">{value}</span>
      {sub && (
        <span className="text-xs text-muted-foreground">({sub})</span>
      )}
    </span>
  );
}

function Sep() {
  return <span className="text-muted-foreground/40 select-none">|</span>;
}
