"use client";

import { Badge } from "@/components/ui/badge";
import { MILESTONE_COLORS, MILESTONE_LABELS, type Milestone } from "@/lib/constants";

export function MilestoneBadge({ milestone }: { milestone: string | null }) {
  if (!milestone) {
    return (
      <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">
        --
      </Badge>
    );
  }

  const color = MILESTONE_COLORS[milestone as Milestone] || "#6b7280";
  const tooltip = MILESTONE_LABELS[milestone as Milestone] || milestone;

  if (milestone === "NR") {
    return (
      <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0" title={tooltip}>
        NR
      </Badge>
    );
  }

  return (
    <Badge
      className="text-white border-0 text-[10px] px-1.5 py-0"
      style={{ backgroundColor: color }}
      title={tooltip}
    >
      {milestone}
    </Badge>
  );
}
