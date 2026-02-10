"use client";

import { useDashboardStats } from "@/queries/dashboard-queries";
import { StatsOverview } from "@/components/dashboard/stats-overview";
import { MilestoneProgress } from "@/components/dashboard/milestone-progress";
import { StatusDistribution } from "@/components/dashboard/status-distribution";
import { EntityProgressCard } from "@/components/dashboard/entity-progress-card";
import type { EntityWithStats } from "@/types/entity";

/** Weighted progress score: closed fields worth 3, in-progress statuses worth 1, unmapped worth 0 */
const STATUS_WEIGHTS: Record<string, number> = {
  fully_closed: 3,
  pending: 1,
  open_comment_sm: 1,
  open_comment_vt: 1,
  unmapped: 0,
};

function progressScore(e: EntityWithStats): number {
  if (!e.statusBreakdown || e.fieldCount === 0) return 0;
  let score = 0;
  for (const [status, count] of Object.entries(e.statusBreakdown)) {
    score += (STATUS_WEIGHTS[status] ?? 0) * count;
  }
  // Normalize to 0–100 scale (max possible = 3 * fieldCount)
  return (score / (3 * e.fieldCount)) * 100;
}

export default function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats();

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-7 bg-muted rounded w-32" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[88px] bg-muted rounded-xl" />
            ))}
          </div>
          <div className="h-24 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-4">
          No data yet. Import a schema to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      <StatsOverview stats={stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {stats.milestoneStats.length > 0 && (
          <MilestoneProgress stats={stats.milestoneStats} />
        )}

        {stats.totalEntities > 0 && <StatusDistribution stats={stats} />}
      </div>

      {stats.entities.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Entities
            </h2>
            <span className="text-xs text-muted-foreground">
              {stats.entities.length} total
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...stats.entities]
              .sort((a, b) => progressScore(b) - progressScore(a))
              .map((e) => (
                <EntityProgressCard key={e.id} entity={e} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
