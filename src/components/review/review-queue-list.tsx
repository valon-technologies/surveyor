"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReviewQueue, useReassignMapping, useBatchExclude } from "@/queries/review-queries";
import { BulkActionBar } from "./bulk-action-bar";
import { useReviewStore } from "@/stores/review-store";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { api, workspacePath } from "@/lib/api-client";
import { EntityGroup } from "./entity-group";
import { MILESTONE_LABELS, MILESTONE_COLORS, type Milestone } from "@/lib/constants";
import type { ReviewCardData, ChildEntityGroup } from "@/types/review";
import { isSystemField } from "@/lib/system-fields";
import { cn } from "@/lib/utils";

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
  const batchExcludeMutation = useBatchExclude();
  const currentUserId = (session?.user as { id?: string })?.id ?? null;

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const selectEntity = useCallback((ids: string[], selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (selected) next.add(id); else next.delete(id); }
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const {
    confidenceFilter,
    entityFilter,
    statusFilter,
    milestoneFilter,
    assigneeFilter,
    setAssigneeFilter,
    hideSystemFields,
    searchQuery,
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

  // Apply client-side filters (milestone + system fields + search)
  const filteredCards = useMemo(() => {
    if (!cards?.length) return cards;
    return cards.filter((c) => {
      if (milestoneFilter !== "all" && c.milestone !== milestoneFilter) return false;
      if (hideSystemFields && isSystemField(c.targetFieldName) && c.status === "unmapped") return false;
      if (assigneeFilter === "mine" && c.assigneeId !== currentUserId) return false;
      if (assigneeFilter === "unclaimed" && c.assigneeId) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !c.targetFieldName.toLowerCase().includes(q) &&
          !c.entityName.toLowerCase().includes(q) &&
          !(c.sourceFieldName || "").toLowerCase().includes(q) &&
          !(c.sourceEntityName || "").toLowerCase().includes(q) &&
          !(c.reasoning || "").toLowerCase().includes(q) &&
          !(c.notes || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [cards, milestoneFilter, hideSystemFields, assigneeFilter, currentUserId, searchQuery]);

  // Clear selection when filters change
  useEffect(() => { clearSelection(); }, [filteredCards]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist filtered queue order for discuss page navigation
  useEffect(() => {
    if (filteredCards?.length) {
      sessionStorage.setItem("reviewQueueOrder", JSON.stringify(filteredCards.map((c) => c.id)));
    }
  }, [filteredCards]);

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

      {/* Workload by assignee */}
      {(() => {
        const workload = new Map<string, { name: string; userId: string; total: number; unreviewed: number; accepted: number }>();
        let unassignedCount = 0;
        let unassignedUnreviewed = 0;
        for (const c of filteredCards) {
          if (!c.assigneeId) {
            unassignedCount++;
            if (c.status === "unreviewed") unassignedUnreviewed++;
            continue;
          }
          let entry = workload.get(c.assigneeId);
          if (!entry) {
            entry = { name: c.assigneeName || "Unknown", userId: c.assigneeId, total: 0, unreviewed: 0, accepted: 0 };
            workload.set(c.assigneeId, entry);
          }
          entry.total++;
          if (c.status === "unreviewed") entry.unreviewed++;
          if (c.status === "accepted") entry.accepted++;
        }
        const entries = Array.from(workload.values()).sort((a, b) => b.unreviewed - a.unreviewed);
        if (entries.length === 0 && unassignedCount === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground font-medium mr-1">Workload:</span>
            {entries.map((e) => (
              <button
                key={e.userId}
                onClick={() => setAssigneeFilter(assigneeFilter === "mine" && e.userId === currentUserId ? "all" : "mine")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 border transition-colors",
                  e.userId === currentUserId
                    ? "border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-700"
                    : "border-border hover:border-foreground/30"
                )}
              >
                <span className="truncate max-w-[80px]">{e.name}</span>
                <span className="font-medium">{e.total}</span>
                {e.unreviewed > 0 && (
                  <span className="text-blue-600">({e.unreviewed} to do)</span>
                )}
              </button>
            ))}
            {unassignedCount > 0 && (
              <button
                onClick={() => setAssigneeFilter(assigneeFilter === "unclaimed" ? "all" : "unclaimed")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 border border-dashed transition-colors",
                  assigneeFilter === "unclaimed"
                    ? "border-foreground bg-foreground/5"
                    : "border-muted-foreground/30 hover:border-foreground/30"
                )}
              >
                <span className="text-muted-foreground">Unassigned</span>
                <span className="font-medium">{unassignedCount}</span>
                {unassignedUnreviewed > 0 && (
                  <span className="text-blue-600">({unassignedUnreviewed} to do)</span>
                )}
              </button>
            )}
          </div>
        );
      })()}

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
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelectEntity={selectEntity}
        />
      ))}

      {/* Bulk action bar */}
      <BulkActionBar
        selectedIds={selectedIds}
        allCards={filteredCards}
        currentUserId={currentUserId}
        onBulkAssign={(ids, assigneeId) => {
          batchAssignMutation.mutate({ mappingIds: ids, assigneeId }, { onSuccess: clearSelection });
        }}
        onBulkExclude={(ids, reason) => {
          batchExcludeMutation.mutate({ mappingIds: ids, reason }, { onSuccess: clearSelection });
        }}
        onClearSelection={clearSelection}
        isPending={batchAssignMutation.isPending || batchExcludeMutation.isPending}
      />
    </div>
  );
}
