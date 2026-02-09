"use client";

import Link from "next/link";
import { Progress } from "@/components/ui/progress";
import { EntityStatusBadge } from "@/components/shared/status-badge";
import { TierBadge } from "@/components/shared/tier-badge";
import type { Entity } from "@/types/entity";

export function EntityRow({
  entity,
}: {
  entity: Entity & { fieldCount: number };
}) {
  // Coverage estimate — not available at list level without mapping data, so show field count
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
        <TierBadge tier={entity.priorityTier} />
      </td>
      <td className="px-4 py-3">
        <EntityStatusBadge status={entity.status} />
      </td>
      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
        {entity.fieldCount}
      </td>
      <td className="px-4 py-3">
        <Progress value={0} indicatorClassName="bg-emerald-500" />
      </td>
    </tr>
  );
}
