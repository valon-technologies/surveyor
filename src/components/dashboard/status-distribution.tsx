"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type MappingStatus,
} from "@/lib/constants";
import type { DashboardStats } from "@/types/dashboard";

export function StatusDistribution({ stats }: { stats: DashboardStats }) {
  const entries = Object.entries(stats.statusDistribution).sort(
    ([, a], [, b]) => b - a
  );

  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <Card>
      <CardHeader className="pb-3 px-4 pt-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Mapping Status
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="flex h-2 rounded-full overflow-hidden bg-muted">
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
        <div className="space-y-1.5">
          {entries.map(([status, count]) => {
            const pct = ((count / total) * 100).toFixed(0);
            return (
              <div
                key={status}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        MAPPING_STATUS_COLORS[status as MappingStatus] ||
                        "#6b7280",
                    }}
                  />
                  <span className="text-muted-foreground">
                    {MAPPING_STATUS_LABELS[status as MappingStatus] || status}
                  </span>
                </div>
                <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
                  <span className="font-medium text-foreground">{count}</span>
                  <span>{pct}%</span>
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
