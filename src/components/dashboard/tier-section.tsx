"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TIER_COLORS, TIER_LABELS, type PriorityTier } from "@/lib/constants";
import { EntityProgressCard } from "./entity-progress-card";
import type { EntityWithStats } from "@/types/entity";

export function TierSection({
  tier,
  entities,
}: {
  tier: PriorityTier | null;
  entities: EntityWithStats[];
}) {
  const [isOpen, setIsOpen] = useState(true);
  const color = tier ? TIER_COLORS[tier] : "#6b7280";
  const label = tier ? TIER_LABELS[tier] : "Unassigned";

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 mb-3 hover:opacity-80 transition-opacity"
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <h2 className="text-lg font-semibold">{label}</h2>
        <span className="text-sm text-muted-foreground">
          ({entities.length} {entities.length === 1 ? "entity" : "entities"})
        </span>
      </button>

      {isOpen && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ml-6">
          {entities.map((e) => (
            <EntityProgressCard key={e.id} entity={e} />
          ))}
        </div>
      )}
    </div>
  );
}
