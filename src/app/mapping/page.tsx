"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { BatchRunPanel } from "@/components/review/batch-run-panel";
import { DistributeDialog } from "@/components/review/distribute-dialog";
import { ReviewFilters } from "@/components/review/review-filters";
import { ReviewQueueList } from "@/components/review/review-queue-list";
import { PuntDialog } from "@/components/review/punt-dialog";
import { ExcludeDialog } from "@/components/review/exclude-dialog";
import { RipplePanel } from "@/components/review/ripple-panel";
import { Button } from "@/components/ui/button";
import { useReviewStore } from "@/stores/review-store";
import { Users } from "lucide-react";
import type { ReviewCardData } from "@/types/review";

export default function MappingPage() {
  const searchParams = useSearchParams();
  const setEntityFilter = useReviewStore((s) => s.setEntityFilter);
  const [puntCard, setPuntCard] = useState<ReviewCardData | null>(null);
  const [excludeCard, setExcludeCard] = useState<ReviewCardData | null>(null);
  const [rippleTarget, setRippleTarget] = useState<ReviewCardData | null>(null);
  const [distributeOpen, setDistributeOpen] = useState(false);

  // Apply entityId from URL params on mount
  useEffect(() => {
    const entityId = searchParams.get("entityId");
    if (entityId) {
      setEntityFilter(entityId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mapping Review</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review AI-generated mappings: discuss, accept, or punt
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDistributeOpen(true)}
        >
          <Users className="h-3.5 w-3.5" />
          Distribute Fields
        </Button>
      </div>

      {/* TODO: Move BatchRunPanel to admin-only page */}
      {/* <BatchRunPanel /> */}

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

      {distributeOpen && (
        <DistributeDialog onClose={() => setDistributeOpen(false)} />
      )}
    </div>
  );
}
