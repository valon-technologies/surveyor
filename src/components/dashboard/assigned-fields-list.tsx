"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  MAPPING_STATUS_LABELS,
  MAPPING_STATUS_COLORS,
  type MappingStatus,
} from "@/lib/constants";
import type { AssignedFieldItem } from "@/types/dashboard";

const STATUS_ORDER: MappingStatus[] = [
  "unmapped",
  "unreviewed",
  "needs_discussion",
  "punted",
];

export function AssignedFieldsList({
  fields,
}: {
  fields: AssignedFieldItem[];
}) {
  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No fields assigned to you right now.
        </p>
      </div>
    );
  }

  // Group by status
  const grouped = new Map<string, AssignedFieldItem[]>();
  for (const f of fields) {
    const list = grouped.get(f.status) ?? [];
    list.push(f);
    grouped.set(f.status, list);
  }

  // Sort groups by STATUS_ORDER
  const orderedStatuses = STATUS_ORDER.filter((s) => grouped.has(s));
  // Include any remaining statuses not in the predefined order
  for (const s of grouped.keys()) {
    if (!orderedStatuses.includes(s as MappingStatus)) {
      orderedStatuses.push(s as MappingStatus);
    }
  }

  return (
    <div className="space-y-4">
      {orderedStatuses.map((status) => {
        const items = grouped.get(status)!;
        const label =
          MAPPING_STATUS_LABELS[status as MappingStatus] ?? status;
        const color =
          MAPPING_STATUS_COLORS[status as MappingStatus] ?? "#6b7280";

        return (
          <div key={status} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {label}
              </span>
              <span className="text-xs text-muted-foreground">
                ({items.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {items.map((f) => (
                <Link
                  key={f.fieldMappingId}
                  href={`/mapping?entityId=${f.entityId}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors group"
                >
                  <span className="text-sm text-muted-foreground group-hover:text-foreground">
                    {f.entityName}
                  </span>
                  <span className="text-muted-foreground/40">/</span>
                  <span className="text-sm font-medium">
                    {f.targetFieldName}
                  </span>
                  {f.confidence && (
                    <Badge variant="outline" className="ml-auto text-[10px] py-0">
                      {f.confidence} confidence
                    </Badge>
                  )}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
