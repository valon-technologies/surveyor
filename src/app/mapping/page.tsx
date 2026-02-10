"use client";

import { useState } from "react";
import { BatchRunPanel } from "@/components/review/batch-run-panel";
import { ReviewFilters } from "@/components/review/review-filters";
import { ReviewQueueList } from "@/components/review/review-queue-list";
import { PuntDialog } from "@/components/review/punt-dialog";
import type { ReviewCardData } from "@/types/review";

export default function MappingPage() {
  const [puntCard, setPuntCard] = useState<ReviewCardData | null>(null);

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

      <ReviewQueueList onPunt={setPuntCard} />

      {puntCard && (
        <PuntDialog card={puntCard} onClose={() => setPuntCard(null)} />
      )}
    </div>
  );
}
