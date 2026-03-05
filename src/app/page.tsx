"use client";

import { useState } from "react";
import { useDashboardStats } from "@/queries/dashboard-queries";
import { CompactStatsRow } from "@/components/dashboard/compact-stats-row";
import { Leaderboard } from "@/components/dashboard/leaderboard";
import { DomainLeaders } from "@/components/dashboard/domain-leaders";
import { EntityProgressTable } from "@/components/dashboard/entity-progress-table";
import { MilestoneProgress } from "@/components/dashboard/milestone-progress";
import { StatusDistribution } from "@/components/dashboard/status-distribution";
import { MyWorkTab } from "@/components/dashboard/my-work-tab";
import { cn } from "@/lib/utils";

type Tab = "overview" | "my-work";

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const { data: stats, isLoading } = useDashboardStats();

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-7 bg-muted rounded w-32" />
          <div className="h-10 bg-muted rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight">Progress Summary</h1>
        <p className="text-sm text-muted-foreground mt-4">
          No data yet. Import a schema to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Progress Summary</h1>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b">
        <TabButton
          active={tab === "overview"}
          onClick={() => setTab("overview")}
        >
          Overview
        </TabButton>
        <TabButton
          active={tab === "my-work"}
          onClick={() => setTab("my-work")}
        >
          My Work
        </TabButton>
      </div>

      {/* Tab Content */}
      {tab === "overview" && (
        <div className="space-y-6">
          <CompactStatsRow stats={stats} />
          <Leaderboard
            data={
              stats.leaderboard ?? {
                mostMapped: [],
                mostQuestionsAnswered: [],
                mostBotCollaborations: [],
              }
            }
          />

          {stats.domainLeaders && stats.domainLeaders.length > 0 && (
            <DomainLeaders data={stats.domainLeaders} />
          )}

          {/* Milestone + Status Distribution */}
          {(stats.milestoneStats.length > 0 || stats.totalEntities > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {stats.milestoneStats.length > 0 && (
                <MilestoneProgress stats={stats.milestoneStats} />
              )}
              {stats.totalEntities > 0 && (
                <StatusDistribution stats={stats} />
              )}
            </div>
          )}

          {/* Entity Progress Table */}
          {stats.entities.length > 0 && (
            <EntityProgressTable entities={stats.entities} />
          )}
        </div>
      )}

      {tab === "my-work" && <MyWorkTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium transition-colors relative",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-t" />
      )}
    </button>
  );
}
