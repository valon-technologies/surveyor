"use client";

import Link from "next/link";
import { EntityStatusBadge } from "@/components/shared/status-badge";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type MappingStatus,
} from "@/lib/constants";
import type { Entity } from "@/types/entity";

const STATUS_ORDER: MappingStatus[] = [
  "fully_closed",
  "pending",
  "open_comment_sm",
  "open_comment_vt",
  "unmapped",
];

export function EntityRow({
  entity,
}: {
  entity: Entity & { fieldCount: number; statusBreakdown: Record<string, number> };
}) {
  return (
    <tr className="border-t hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/mapping/${entity.id}`}
          className="font-medium text-sm hover:underline"
        >
          {entity.displayName || entity.name}
        </Link>
        {entity.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">
            {entity.description}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <EntityStatusBadge status={entity.status} />
      </td>
      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
        {entity.fieldCount}
      </td>
      <td className="px-4 py-3">
        <div className="flex h-2 rounded-full overflow-hidden bg-muted">
          {entity.fieldCount > 0 &&
            STATUS_ORDER.map((status) => {
              const count = entity.statusBreakdown?.[status] || 0;
              if (count === 0) return null;
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
      </td>
    </tr>
  );
}
