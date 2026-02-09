"use client";

import { useDashboardStats } from "@/queries/dashboard-queries";
import { StatsOverview } from "@/components/dashboard/stats-overview";
import { TierSection } from "@/components/dashboard/tier-section";
import { StatusDistribution } from "@/components/dashboard/status-distribution";

export default function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats();

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold tracking-tight">Surveyor</h1>
        <p className="text-muted-foreground mt-1">
          Field-Level Data Mapping Studio
        </p>
        <p className="text-sm text-muted-foreground mt-4">
          Import a schema to get started. Go to Schemas to upload a CSV.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Surveyor</h1>
        <p className="text-muted-foreground mt-1">
          Field-Level Data Mapping Studio
        </p>
      </div>

      <StatsOverview stats={stats} />

      {stats.totalEntities > 0 && <StatusDistribution stats={stats} />}

      {stats.entitiesByTier.P0.length > 0 && (
        <TierSection tier="P0" entities={stats.entitiesByTier.P0} />
      )}
      {stats.entitiesByTier.P1.length > 0 && (
        <TierSection tier="P1" entities={stats.entitiesByTier.P1} />
      )}
      {stats.entitiesByTier.P2.length > 0 && (
        <TierSection tier="P2" entities={stats.entitiesByTier.P2} />
      )}
      {stats.entitiesByTier.unassigned.length > 0 && (
        <TierSection tier={null} entities={stats.entitiesByTier.unassigned} />
      )}
    </div>
  );
}
