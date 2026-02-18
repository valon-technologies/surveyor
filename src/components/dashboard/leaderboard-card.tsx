"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import type { LeaderboardEntry } from "@/types/dashboard";

interface LeaderboardCardProps {
  title: string;
  icon: LucideIcon;
  entries: LeaderboardEntry[];
  emptyMessage?: string;
}

export function LeaderboardCard({
  title,
  icon: Icon,
  entries,
  emptyMessage = "No activity yet",
}: LeaderboardCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ol className="space-y-2">
            {entries.map((entry, i) => (
              <li key={entry.userId} className="flex items-center gap-2.5">
                <span className="w-4 text-right text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <Avatar name={entry.name} image={entry.image} size="sm" />
                <span className="flex-1 truncate text-sm">
                  {entry.name ?? "Unknown"}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {entry.count}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
