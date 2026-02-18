"use client";

import Link from "next/link";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type MappingStatus,
} from "@/lib/constants";
import type { EntityWithStats } from "@/types/entity";

const STATUS_ORDER: MappingStatus[] = [
  "accepted",
  "excluded",
  "unreviewed",
  "punted",
  "needs_discussion",
  "unmapped",
];

/** Weighted progress score for sorting */
const STATUS_WEIGHTS: Record<string, number> = {
  accepted: 3,
  excluded: 2,
  unreviewed: 1,
  punted: 1,
  needs_discussion: 1,
  unmapped: 0,
};

function progressScore(e: EntityWithStats): number {
  if (!e.statusBreakdown || e.fieldCount === 0) return 0;
  let score = 0;
  for (const [status, count] of Object.entries(e.statusBreakdown)) {
    score += (STATUS_WEIGHTS[status] ?? 0) * count;
  }
  return (score / (3 * e.fieldCount)) * 100;
}

export function EntityProgressTable({
  entities,
}: {
  entities: EntityWithStats[];
}) {
  if (entities.length === 0) return null;

  const sorted = [...entities].sort(
    (a, b) => progressScore(b) - progressScore(a)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Entity Progress
        </h2>
        <span className="text-xs text-muted-foreground">
          {entities.length} entities
        </span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left font-medium text-muted-foreground px-3 py-2">
                Entity
              </th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2 w-20">
                Fields
              </th>
              <th className="font-medium text-muted-foreground px-3 py-2 w-48 hidden md:table-cell">
                Status
              </th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2 w-20">
                Coverage
              </th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2 w-16">
                Qs
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr
                key={e.id}
                className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/mapping?entityId=${e.id}`}
                    className="hover:underline underline-offset-2"
                  >
                    {e.displayName || e.name}
                  </Link>
                </td>
                <td className="text-right px-3 py-2 tabular-nums text-muted-foreground">
                  {e.fieldCount}
                </td>
                <td className="px-3 py-2 hidden md:table-cell">
                  <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                    {STATUS_ORDER.map((status) => {
                      const count = e.statusBreakdown?.[status] || 0;
                      if (count === 0 || e.fieldCount === 0) return null;
                      const pct = (count / e.fieldCount) * 100;
                      return (
                        <div
                          key={status}
                          className="h-full"
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
                </td>
                <td className="text-right px-3 py-2 tabular-nums font-medium">
                  {e.coveragePercent}%
                </td>
                <td className="text-right px-3 py-2 tabular-nums">
                  {e.openQuestions > 0 ? (
                    <span className="text-amber-500">{e.openQuestions}</span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            className="flex items-center gap-1.5 text-[11px]"
          >
            <span
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
    </div>
  );
}
