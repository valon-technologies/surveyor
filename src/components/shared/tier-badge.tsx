"use client";

import { Badge } from "@/components/ui/badge";
import { TIER_COLORS, type PriorityTier } from "@/lib/constants";

export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        --
      </Badge>
    );
  }

  const color = TIER_COLORS[tier as PriorityTier] || "#6b7280";

  return (
    <Badge
      className="text-white border-0"
      style={{ backgroundColor: color }}
    >
      {tier}
    </Badge>
  );
}
