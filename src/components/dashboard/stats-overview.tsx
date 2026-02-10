"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { DashboardStats } from "@/types/dashboard";
import { Database, GitBranch, CheckCircle, HelpCircle } from "lucide-react";

export function StatsOverview({ stats }: { stats: DashboardStats }) {
  const statCards = [
    {
      label: "Entities",
      value: stats.totalEntities,
      icon: Database,
      iconBg: "bg-blue-500/10",
      iconColor: "text-blue-500",
    },
    {
      label: "Fields",
      value: stats.totalFields.toLocaleString(),
      icon: GitBranch,
      iconBg: "bg-purple-500/10",
      iconColor: "text-purple-500",
    },
    {
      label: "Coverage",
      value: `${stats.coveragePercent}%`,
      sub: `${stats.mappedFields.toLocaleString()} of ${stats.totalFields.toLocaleString()}`,
      icon: CheckCircle,
      iconBg:
        stats.coveragePercent >= 75
          ? "bg-emerald-500/10"
          : stats.coveragePercent >= 50
            ? "bg-amber-500/10"
            : "bg-zinc-500/10",
      iconColor:
        stats.coveragePercent >= 75
          ? "text-emerald-500"
          : stats.coveragePercent >= 50
            ? "text-amber-500"
            : "text-zinc-400",
    },
    {
      label: "Open Questions",
      value: stats.openQuestions,
      icon: HelpCircle,
      iconBg: stats.openQuestions > 0 ? "bg-amber-500/10" : "bg-zinc-500/10",
      iconColor: stats.openQuestions > 0 ? "text-amber-500" : "text-zinc-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {statCards.map((s) => (
        <Card key={s.label}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div
                className={`shrink-0 rounded-lg p-2 ${s.iconBg}`}
              >
                <s.icon className={`h-4 w-4 ${s.iconColor}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-semibold tracking-tight mt-0.5">
                  {s.value}
                </p>
                {s.sub && (
                  <p className="text-[11px] text-muted-foreground">{s.sub}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
