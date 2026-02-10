"use client";

import { useReviewQueue } from "@/queries/review-queries";
import { useReviewStore } from "@/stores/review-store";
import { ReviewCard } from "./review-card";
import type { ReviewCardData } from "@/types/review";

interface ReviewQueueListProps {
  onPunt: (card: ReviewCardData) => void;
}

export function ReviewQueueList({ onPunt }: ReviewQueueListProps) {
  const {
    confidenceFilter,
    entityFilter,
    reviewStatusFilter,
    sortBy,
    sortOrder,
  } = useReviewStore();

  const { data: cards, isLoading } = useReviewQueue({
    confidence: confidenceFilter,
    entityId: entityFilter,
    reviewStatus: reviewStatusFilter,
    sortBy,
    sortOrder,
  });

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

  const unreviewedCount = cards.filter((c) => !c.reviewStatus).length;
  const acceptedCount = cards.filter((c) => c.reviewStatus === "accepted").length;
  const puntedCount = cards.filter((c) => c.reviewStatus === "punted").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{cards.length} total</span>
        {unreviewedCount > 0 && (
          <span className="text-blue-600">{unreviewedCount} to review</span>
        )}
        {acceptedCount > 0 && (
          <span className="text-green-600">{acceptedCount} accepted</span>
        )}
        {puntedCount > 0 && (
          <span className="text-amber-600">{puntedCount} punted</span>
        )}
      </div>

      {cards.map((card) => (
        <ReviewCard key={card.id} card={card} onPunt={onPunt} />
      ))}
    </div>
  );
}
