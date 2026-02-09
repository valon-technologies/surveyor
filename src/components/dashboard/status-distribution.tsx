"use client";

import { MAPPING_STATUS_COLORS, MAPPING_STATUS_LABELS, type MappingStatus } from "@/lib/constants";
import type { DashboardStats } from "@/types/dashboard";

export function StatusDistribution({ stats }: { stats: DashboardStats }) {
  const entries = Object.entries(stats.statusDistribution).sort(
    ([, a], [, b]) => b - a
  );

  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">
        Mapping Status Distribution
      </h3>
      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
        {entries.map(([status, count]) => {
          const pct = (count / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={status}
              className="h-full transition-all"
              style={{
                width: `${pct}%`,
                backgroundColor:
                  MAPPING_STATUS_COLORS[status as MappingStatus] || "#6b7280",
              }}
              title={`${MAPPING_STATUS_LABELS[status as MappingStatus] || status}: ${count}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([status, count]) => (
          <div key={status} className="flex items-center gap-1.5 text-xs">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor:
                  MAPPING_STATUS_COLORS[status as MappingStatus] || "#6b7280",
              }}
            />
            <span className="text-muted-foreground">
              {MAPPING_STATUS_LABELS[status as MappingStatus] || status}:{" "}
              <span className="font-medium text-foreground">{count}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
