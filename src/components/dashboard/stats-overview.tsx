"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { DashboardStats } from "@/types/dashboard";
import { Database, GitBranch, CheckCircle, HelpCircle } from "lucide-react";

export function StatsOverview({ stats }: { stats: DashboardStats }) {
  const statCards = [
    {
      label: "Target Entities",
      value: stats.totalEntities,
      icon: Database,
      color: "text-blue-500",
    },
    {
      label: "Total Fields",
      value: stats.totalFields,
      icon: GitBranch,
      color: "text-purple-500",
    },
    {
      label: "Coverage",
      value: `${stats.coveragePercent}%`,
      sub: `${stats.mappedFields} / ${stats.totalFields} fields`,
      icon: CheckCircle,
      color: stats.coveragePercent >= 75 ? "text-green-500" : stats.coveragePercent >= 50 ? "text-yellow-500" : "text-gray-400",
    },
    {
      label: "Open Questions",
      value: stats.openQuestions,
      icon: HelpCircle,
      color: stats.openQuestions > 0 ? "text-amber-500" : "text-gray-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {statCards.map((s) => (
        <Card key={s.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <s.icon className={`h-5 w-5 ${s.color}`} />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                {s.sub && (
                  <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
