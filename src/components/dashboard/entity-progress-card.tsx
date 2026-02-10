"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { EntityStatusBadge } from "@/components/shared/status-badge";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type MappingStatus,
} from "@/lib/constants";
import type { EntityWithStats } from "@/types/entity";

const STATUS_ORDER: MappingStatus[] = [
  "fully_closed",
  "excluded",
  "pending",
  "open_comment_sm",
  "open_comment_vt",
  "unmapped",
];

export function EntityProgressCard({ entity }: { entity: EntityWithStats }) {
  return (
    <Link href={`/mapping/${entity.id}`}>
      <Card className="hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer h-full">
        <CardContent className="p-4 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-sm truncate">
                {entity.displayName || entity.name}
              </h3>
              {entity.displayName && entity.displayName !== entity.name && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {entity.name}
                </p>
              )}
            </div>
            <EntityStatusBadge status={entity.status} />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>
                {entity.mappedCount}/{entity.fieldCount} fields
              </span>
              <span className="font-medium text-foreground">
                {entity.coveragePercent}%
              </span>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
              {STATUS_ORDER.map((status) => {
                const count = entity.statusBreakdown?.[status] || 0;
                if (count === 0 || entity.fieldCount === 0) return null;
                const pct = (count / entity.fieldCount) * 100;
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

          {entity.openQuestions > 0 && (
            <p className="text-[11px] text-amber-500">
              {entity.openQuestions} open question
              {entity.openQuestions > 1 ? "s" : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
