"use client";

import type { DashboardStats } from "@/types/dashboard";

export function CompactStatsRow({ stats }: { stats: DashboardStats }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-muted/50 px-4 py-2.5 text-sm">
      <Stat label="Entities" value={stats.totalEntities.toLocaleString()} />
      <Sep />
      <Stat label="Fields" value={stats.totalFields.toLocaleString()} />
      <Sep />
      <Stat
        label="Coverage"
        value={`${stats.coveragePercent}%`}
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
