"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { BatchRunPanel } from "@/components/review/batch-run-panel";
import { ReviewFilters } from "@/components/review/review-filters";
import { ReviewQueueList } from "@/components/review/review-queue-list";
import { PuntDialog } from "@/components/review/punt-dialog";
import { ExcludeDialog } from "@/components/review/exclude-dialog";
import { RipplePanel } from "@/components/review/ripple-panel";
import { useReviewStore } from "@/stores/review-store";
import type { ReviewCardData } from "@/types/review";

export default function MappingPage() {
  const searchParams = useSearchParams();
  const setEntityFilter = useReviewStore((s) => s.setEntityFilter);
  const [puntCard, setPuntCard] = useState<ReviewCardData | null>(null);
  const [excludeCard, setExcludeCard] = useState<ReviewCardData | null>(null);
  const [rippleTarget, setRippleTarget] = useState<ReviewCardData | null>(null);

  // Apply entityId from URL params on mount
  useEffect(() => {
    const entityId = searchParams.get("entityId");
    if (entityId) {
      setEntityFilter(entityId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mapping Review</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Review AI-generated mappings: discuss, accept, or punt
        </p>
      </div>

      <BatchRunPanel />

      <ReviewFilters />

      <ReviewQueueList
        onPunt={setPuntCard}
        onExclude={setExcludeCard}
        onAcceptWithRipple={setRippleTarget}
      />

      {puntCard && (
        <PuntDialog card={puntCard} onClose={() => setPuntCard(null)} />
      )}

      {excludeCard && (
        <ExcludeDialog card={excludeCard} onClose={() => setExcludeCard(null)} />
      )}

      {rippleTarget && (
        <RipplePanel card={rippleTarget} onClose={() => setRippleTarget(null)} />
      )}
    </div>
  );
}
