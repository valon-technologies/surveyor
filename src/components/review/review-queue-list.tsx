"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReviewQueue, useReassignMapping } from "@/queries/review-queries";
import { useReviewStore } from "@/stores/review-store";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { api, workspacePath } from "@/lib/api-client";
import { EntityGroup } from "./entity-group";
import { MILESTONE_LABELS, MILESTONE_COLORS, type Milestone } from "@/lib/constants";
import type { ReviewCardData, ChildEntityGroup } from "@/types/review";

interface ReviewQueueListProps {
  onPunt: (card: ReviewCardData) => void;
  onExclude: (card: ReviewCardData) => void;
  onAcceptWithRipple?: (card: ReviewCardData) => void;
}

interface EntityGroupData {
  entityId: string;
  entityName: string;
  cards: ReviewCardData[];
  childGroups: ChildEntityGroup[];
  totalCardCount: number;
  unreviewedCount: number;
}

export function ReviewQueueList({ onPunt, onExclude, onAcceptWithRipple }: ReviewQueueListProps) {
  const { data: session } = useSession();
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const claimMutation = useReassignMapping();
  const batchAssignMutation = useMutation({
    mutationFn: ({ mappingIds, assigneeId }: { mappingIds: string[]; assigneeId: string | null }) =>
      api.post(workspacePath(workspaceId, "mappings/batch-assign"), { mappingIds, assigneeId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
    },
  });
  const currentUserId = (session?.user as { id?: string })?.id ?? null;

  const {
    confidenceFilter,
    entityFilter,
    statusFilter,
    milestoneFilter,
    hideSystemFields,
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

  // Apply client-side filters (milestone + system fields)
  const filteredCards = useMemo(() => {
    if (!cards?.length) return cards;
    return cards.filter((c) => {
      if (milestoneFilter !== "all" && c.milestone !== milestoneFilter) return false;
      if (hideSystemFields && /(_id|_sid)$/.test(c.targetFieldName) && c.status === "unmapped") return false;
      return true;
    });
  }, [cards, milestoneFilter, hideSystemFields]);

  // Group cards by entity with hierarchical parent/child folding
  const entityGroups = useMemo<EntityGroupData[]>(() => {
    if (!filteredCards?.length) return [];

    // Pass 1: bucket cards by their own entityId
    const bucketMap = new Map<string, { entityName: string; cards: ReviewCardData[]; parentEntityId: string | null; parentEntityName: string | null }>();
    for (const card of filteredCards) {
      let bucket = bucketMap.get(card.entityId);
      if (!bucket) {
        bucket = { entityName: card.entityName, cards: [], parentEntityId: card.parentEntityId, parentEntityName: card.parentEntityName };
        bucketMap.set(card.entityId, bucket);
      }
      bucket.cards.push(card);
    }

    // Pass 2: build parent groups, attaching child buckets
    const parentMap = new Map<string, EntityGroupData>();

    for (const [eid, bucket] of bucketMap) {
      if (bucket.parentEntityId) {
        // This is a child entity — attach to parent group
        let parent = parentMap.get(bucket.parentEntityId);
        if (!parent) {
          // Synthetic parent (has no cards of its own yet)
          parent = {
            entityId: bucket.parentEntityId,
            entityName: bucket.parentEntityName || bucket.parentEntityId,
            cards: [],
            childGroups: [],
            totalCardCount: 0,
            unreviewedCount: 0,
          };
          parentMap.set(bucket.parentEntityId, parent);
        }
        parent.childGroups.push({ entityId: eid, entityName: bucket.entityName, cards: bucket.cards });
      } else {
        // Top-level entity
        let existing = parentMap.get(eid);
        if (existing) {
          // Already created as synthetic parent — fill in its own cards
          existing.cards = bucket.cards;
          existing.entityName = bucket.entityName;
        } else {
          parentMap.set(eid, {
            entityId: eid,
            entityName: bucket.entityName,
            cards: bucket.cards,
            childGroups: [],
            totalCardCount: 0,
            unreviewedCount: 0,
          });
        }
      }
    }

    // Compute totals
    const groups = Array.from(parentMap.values());
    for (const g of groups) {
      const allCards = [...g.cards, ...g.childGroups.flatMap((cg) => cg.cards)];
      g.totalCardCount = allCards.length;
      g.unreviewedCount = allCards.filter((c) => c.status === "unreviewed").length;
      // Sort child groups alphabetically
      g.childGroups.sort((a, b) => a.entityName.localeCompare(b.entityName));
    }

    // Sort: entities with unreviewed fields first (desc count), then alphabetical
    groups.sort((a, b) => {
      if (a.unreviewedCount !== b.unreviewedCount) {
        return b.unreviewedCount - a.unreviewedCount;
      }
      return a.entityName.localeCompare(b.entityName);
    });

    return groups;
  }, [filteredCards]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!filteredCards?.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">No mappings to review</p>
        <p className="text-xs mt-1">
          Start a batch run to generate mappings, or adjust your filters
        </p>
      </div>
    );
  }

  const unreviewedCount = filteredCards.filter((c) => c.status === "unreviewed").length;
  const acceptedCount = filteredCards.filter((c) => c.status === "accepted").length;
  const excludedCount = filteredCards.filter((c) => c.status === "excluded").length;
  const puntedCount = filteredCards.filter((c) => c.status === "punted").length;

  const reviewedCount = acceptedCount + excludedCount;
  const reviewPct = filteredCards.length > 0 ? Math.round((reviewedCount / filteredCards.length) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Overall progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4 text-muted-foreground">
            <span>{filteredCards.length} fields across {entityGroups.length} entities</span>
            {unreviewedCount > 0 && (
              <span className="text-blue-600">{unreviewedCount} to review</span>
            )}
            {puntedCount > 0 && (
              <span className="text-amber-600">{puntedCount} punted</span>
            )}
          </div>
          <span className={reviewedCount > 0 ? "text-green-600 font-medium" : "text-muted-foreground"}>
            {reviewedCount}/{filteredCards.length} reviewed ({reviewPct}%)
          </span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-muted">
          {acceptedCount > 0 && (
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${(acceptedCount / filteredCards.length) * 100}%` }}
              title={`${acceptedCount} accepted`}
            />
          )}
          {excludedCount > 0 && (
            <div
              className="h-full bg-stone-400 transition-all"
              style={{ width: `${(excludedCount / filteredCards.length) * 100}%` }}
              title={`${excludedCount} excluded`}
            />
          )}
          {puntedCount > 0 && (
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${(puntedCount / filteredCards.length) * 100}%` }}
              title={`${puntedCount} punted`}
            />
          )}
        </div>
      </div>

      {entityGroups.map((group) => (
        <EntityGroup
          key={group.entityId}
          entityId={group.entityId}
          entityName={group.entityName}
          cards={group.cards}
          childGroups={group.childGroups}
          totalCardCount={group.totalCardCount}
          onPunt={onPunt}
          onExclude={onExclude}
          onAcceptWithRipple={onAcceptWithRipple}
          currentUserId={currentUserId}
          onClaim={(mappingId, assigneeId) => claimMutation.mutate({ mappingId, assigneeId })}
          onBatchAssign={(mappingIds, assigneeId) => batchAssignMutation.mutate({ mappingIds, assigneeId })}
        />
      ))}
    </div>
  );
}
