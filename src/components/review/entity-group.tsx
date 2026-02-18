"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ReviewCard } from "./review-card";
import { useReviewStore } from "@/stores/review-store";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type MappingStatus,
} from "@/lib/constants";
import type { ReviewCardData } from "@/types/review";

const STATUS_ORDER: MappingStatus[] = [
  "accepted",
  "excluded",
  "unreviewed",
  "punted",
  "needs_discussion",
  "unmapped",
];

interface EntityGroupProps {
  entityId: string;
  entityName: string;
  cards: ReviewCardData[];
  onPunt: (card: ReviewCardData) => void;
  onExclude: (card: ReviewCardData) => void;
  onAcceptWithRipple?: (card: ReviewCardData) => void;
}

export function EntityGroup({
  entityId,
  entityName,
  cards,
  onPunt,
  onExclude,
  onAcceptWithRipple,
}: EntityGroupProps) {
  const { collapsedEntityIds, toggleEntityCollapsed } = useReviewStore();
  const isCollapsed = collapsedEntityIds.includes(entityId);

  // Compute status counts
  const statusCounts = new Map<MappingStatus, number>();
  for (const c of cards) {
    statusCounts.set(c.status, (statusCounts.get(c.status) || 0) + 1);
  }

  const total = cards.length;

  // Push excluded cards to the bottom, preserve original order otherwise
  const sortedCards = useMemo(() => {
    const nonExcluded = cards.filter((c) => c.status !== "excluded");
    const excluded = cards.filter((c) => c.status === "excluded");
    return [...nonExcluded, ...excluded];
  }, [cards]);

  // Build status summary string (non-zero only)
  const statusParts: { label: string; count: number; color: string }[] = [];
  for (const status of STATUS_ORDER) {
    const count = statusCounts.get(status) || 0;
    if (count > 0) {
      statusParts.push({
        label: MAPPING_STATUS_LABELS[status].toLowerCase(),
        count,
        color: MAPPING_STATUS_COLORS[status],
      });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Header */}
      <button
        onClick={() => toggleEntityCollapsed(entityId)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors rounded-t-xl"
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <span className="font-semibold text-sm">{entityName}</span>

        {/* Status counts */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-1">
          {statusParts.map((part, i) => (
            <span key={part.label}>
              {i > 0 && <span className="mx-0.5">·</span>}
              <span style={{ color: part.color }}>{part.count} {part.label}</span>
            </span>
          ))}
        </div>

        {/* Mini segmented progress bar */}
        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted ml-auto w-24 shrink-0">
          {STATUS_ORDER.map((status) => {
            const count = statusCounts.get(status) || 0;
            if (count === 0 || total === 0) return null;
            const pct = (count / total) * 100;
            return (
              <div
                key={status}
                className="h-full transition-all"
                style={{
                  width: `${pct}%`,
                  backgroundColor: MAPPING_STATUS_COLORS[status] || "#6b7280",
                }}
                title={`${MAPPING_STATUS_LABELS[status]}: ${count}`}
              />
            );
          })}
        </div>
      </button>

      {/* Body — collapsible, default open */}
      {!isCollapsed && (
        <div className="px-3 pb-3 space-y-1">
          {sortedCards.map((card) => (
            <ReviewCard
              key={card.id}
              card={card}
              onPunt={onPunt}
              onExclude={onExclude}
              onAcceptWithRipple={onAcceptWithRipple}
            />
          ))}
        </div>
      )}
    </div>
  );
}
