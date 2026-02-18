"use client";

import { useMemo } from "react";
import { useReviewQueue } from "@/queries/review-queries";
import { useReviewStore } from "@/stores/review-store";
import { EntityGroup } from "./entity-group";
import type { ReviewCardData } from "@/types/review";

interface ReviewQueueListProps {
  onPunt: (card: ReviewCardData) => void;
  onExclude: (card: ReviewCardData) => void;
  onAcceptWithRipple?: (card: ReviewCardData) => void;
}

interface EntityGroupData {
  entityId: string;
  entityName: string;
  cards: ReviewCardData[];
  unreviewedCount: number;
}

export function ReviewQueueList({ onPunt, onExclude, onAcceptWithRipple }: ReviewQueueListProps) {
  const {
    confidenceFilter,
    entityFilter,
    statusFilter,
    sortBy,
    sortOrder,
  } = useReviewStore();

  const { data: cards, isLoading } = useReviewQueue({
    confidence: confidenceFilter,
    entityId: entityFilter,
    status: statusFilter,
    sortBy,
    sortOrder,
  });

  // Group cards by entity
  const entityGroups = useMemo<EntityGroupData[]>(() => {
    if (!cards?.length) return [];

    const groupMap = new Map<string, EntityGroupData>();

    for (const card of cards) {
      let group = groupMap.get(card.entityId);
      if (!group) {
        group = {
          entityId: card.entityId,
          entityName: card.entityName,
          cards: [],
          unreviewedCount: 0,
        };
        groupMap.set(card.entityId, group);
      }
      group.cards.push(card);
      if (card.status === "unreviewed") {
        group.unreviewedCount++;
      }
    }

    const groups = Array.from(groupMap.values());

    // Sort: entities with unreviewed fields first (desc count), then alphabetical
    groups.sort((a, b) => {
      if (a.unreviewedCount !== b.unreviewedCount) {
        return b.unreviewedCount - a.unreviewedCount;
      }
      return a.entityName.localeCompare(b.entityName);
    });

    return groups;
  }, [cards]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!cards?.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">No mappings to review</p>
        <p className="text-xs mt-1">
          Start a batch run to generate mappings, or adjust your filters
        </p>
      </div>
    );
  }

  const unreviewedCount = cards.filter((c) => c.status === "unreviewed").length;
  const acceptedCount = cards.filter((c) => c.status === "accepted").length;
  const excludedCount = cards.filter((c) => c.status === "excluded").length;
  const puntedCount = cards.filter((c) => c.status === "punted").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-1">
        <span>{cards.length} total across {entityGroups.length} entities</span>
        {unreviewedCount > 0 && (
          <span className="text-blue-600">{unreviewedCount} to review</span>
        )}
        {acceptedCount > 0 && (
          <span className="text-green-600">{acceptedCount} accepted</span>
        )}
        {puntedCount > 0 && (
          <span className="text-amber-600">{puntedCount} punted</span>
        )}
        {excludedCount > 0 && (
          <span className="text-stone-400">{excludedCount} excluded</span>
        )}
      </div>

      {entityGroups.map((group) => (
        <EntityGroup
          key={group.entityId}
          entityId={group.entityId}
          entityName={group.entityName}
          cards={group.cards}
          onPunt={onPunt}
          onExclude={onExclude}
          onAcceptWithRipple={onAcceptWithRipple}
        />
      ))}
    </div>
  );
}
