"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EntityStatusBadge } from "@/components/shared/status-badge";
import { TierBadge } from "@/components/shared/tier-badge";
import type { EntityWithStats } from "@/types/entity";

export function EntityProgressCard({ entity }: { entity: EntityWithStats }) {
  return (
    <Link href={`/mapping/${entity.id}`}>
      <Card className="hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-sm truncate">
                {entity.displayName || entity.name}
              </h3>
              {entity.displayName && entity.displayName !== entity.name && (
                <p className="text-xs text-muted-foreground truncate">{entity.name}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <TierBadge tier={entity.priorityTier} />
              <EntityStatusBadge status={entity.status} />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {entity.mappedCount} / {entity.fieldCount} fields
              </span>
              <span>{entity.coveragePercent}%</span>
            </div>
            <Progress
              value={entity.coveragePercent}
              indicatorClassName="bg-emerald-500"
            />
          </div>

          {entity.openQuestions > 0 && (
            <p className="text-xs text-amber-600">
              {entity.openQuestions} open question{entity.openQuestions > 1 ? "s" : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
