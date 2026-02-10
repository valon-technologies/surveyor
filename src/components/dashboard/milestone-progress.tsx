"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MILESTONE_LABELS,
  MILESTONE_COLORS,
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type Milestone,
  type MappingStatus,
} from "@/lib/constants";
import type { MilestoneStats } from "@/types/dashboard";

/** Ordered statuses for consistent stacked bar rendering (done → in-progress → unmapped) */
const STATUS_ORDER: MappingStatus[] = [
  "fully_closed",
  "pending",
  "open_comment_sm",
  "open_comment_vt",
  "unmapped",
];

export function MilestoneProgress({ stats }: { stats: MilestoneStats[] }) {
  const hasAny = stats.some((s) => s.totalFields > 0);
  if (!hasAny) return null;

  // Collect which statuses actually appear across all milestones for the legend
  const activeStatuses = new Set<string>();
  for (const s of stats) {
    for (const status of Object.keys(s.statusBreakdown)) {
      activeStatuses.add(status);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3 px-4 pt-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Milestone Coverage
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {stats.map((s) => {
          if (s.totalFields === 0) return null;
          const milestoneColor = MILESTONE_COLORS[s.milestone as Milestone];
          const label = MILESTONE_LABELS[s.milestone as Milestone];
          return (
            <div key={s.milestone} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: milestoneColor }}
                  />
                  <span className="font-medium">{label}</span>
                </div>
                <span className="text-muted-foreground tabular-nums">
                  {s.totalFields} fields
                </span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                {STATUS_ORDER.map((status) => {
                  const count = s.statusBreakdown[status] || 0;
                  if (count === 0) return null;
                  const pct = (count / s.totalFields) * 100;
                  return (
                    <div
                      key={status}
                      className="h-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          MAPPING_STATUS_COLORS[status] || "#6b7280",
                      }}
                      title={`${MAPPING_STATUS_LABELS[status] || status}: ${count}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Shared legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t">
          {STATUS_ORDER.filter((s) => activeStatuses.has(s)).map((status) => (
            <div key={status} className="flex items-center gap-1.5 text-[11px]">
              <div
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: MAPPING_STATUS_COLORS[status] || "#6b7280",
                }}
              />
              <span className="text-muted-foreground">
                {MAPPING_STATUS_LABELS[status] || status}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
