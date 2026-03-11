"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Component, MessageSquare } from "lucide-react";
import { ReviewCard } from "./review-card";
import { cn } from "@/lib/utils";
import { useReviewStore } from "@/stores/review-store";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type MappingStatus,
} from "@/lib/constants";
import type { ReviewCardData, ChildEntityGroup } from "@/types/review";

const STATUS_ORDER: MappingStatus[] = [
  "accepted",
  "excluded",
  "unreviewed",
  "punted",
  "needs_discussion",
  "unmapped",
];

const CARD_SORT_ORDER: Record<string, number> = {
  unreviewed: 0,
  unmapped: 0,
  punted: 0,
  needs_discussion: 0,
  accepted: 1,
  excluded: 2,
};

const CONFIDENCE_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function sortCards(cards: ReviewCardData[]) {
  return [...cards].sort((a, b) => {
    const statusCmp = (CARD_SORT_ORDER[a.status] ?? 0) - (CARD_SORT_ORDER[b.status] ?? 0);
    if (statusCmp !== 0) return statusCmp;
    return (CONFIDENCE_ORDER[a.confidence ?? "low"] ?? 3) - (CONFIDENCE_ORDER[b.confidence ?? "low"] ?? 3);
  });
}

interface EntityGroupProps {
  entityId: string;
  entityName: string;
  cards: ReviewCardData[];
  childGroups: ChildEntityGroup[];
  totalCardCount: number;
  onPunt: (card: ReviewCardData) => void;
  onExclude: (card: ReviewCardData) => void;
  onAcceptWithRipple?: (card: ReviewCardData) => void;
  currentUserId?: string | null;
  onClaim?: (mappingId: string, assigneeId: string | null) => void;
  onBatchAssign?: (mappingIds: string[], assigneeId: string | null) => void;
  onExcludeEntity?: (entityId: string, entityName: string) => void;
}

export function EntityGroup({
  entityId,
  entityName,
  cards,
  childGroups,
  totalCardCount,
  onPunt,
  onExclude,
  onAcceptWithRipple,
  currentUserId,
  onClaim,
  onBatchAssign,
  onExcludeEntity,
}: EntityGroupProps) {
  const router = useRouter();
  const { collapsedEntityIds, toggleEntityCollapsed } = useReviewStore();
  const isCollapsed = collapsedEntityIds.includes(entityId);

  // Entity-level claim: all cards including children
  const allCardIds = useMemo(() => {
    const ids = cards.map((c) => c.id);
    for (const child of childGroups) {
      ids.push(...child.cards.map((c) => c.id));
    }
    return ids;
  }, [cards, childGroups]);
  const allClaimedByMe = currentUserId && allCardIds.length > 0 &&
    [...cards, ...childGroups.flatMap((c) => c.cards)].every((c) => c.assigneeId === currentUserId);
  const someClaimedByMe = currentUserId &&
    [...cards, ...childGroups.flatMap((c) => c.cards)].some((c) => c.assigneeId === currentUserId);

  // Aggregate status counts across parent + all children
  const allCards = useMemo(
    () => [...cards, ...childGroups.flatMap((cg) => cg.cards)],
    [cards, childGroups],
  );

  const statusCounts = new Map<MappingStatus, number>();
  for (const c of allCards) {
    statusCounts.set(c.status, (statusCounts.get(c.status) || 0) + 1);
  }

  const total = totalCardCount || allCards.length;

  const sortedCards = useMemo(() => sortCards(cards), [cards]);

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
      <div
        role="button"
        tabIndex={0}
        onClick={() => toggleEntityCollapsed(entityId)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleEntityCollapsed(entityId); } }}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors rounded-t-xl cursor-pointer"
      >
        {/* Entity-level claim checkbox */}
        {onBatchAssign && currentUserId && (
          <input
            type="checkbox"
            checked={!!allClaimedByMe}
            ref={(el) => { if (el) el.indeterminate = !!someClaimedByMe && !allClaimedByMe; }}
            onChange={(e) => {
              e.stopPropagation();
              onBatchAssign(allCardIds, allClaimedByMe ? null : currentUserId);
            }}
            onClick={(e) => e.stopPropagation()}
            title={allClaimedByMe ? "Release all fields" : "Claim all fields in this entity"}
            className="h-3.5 w-3.5 rounded border-gray-300 text-primary cursor-pointer shrink-0"
          />
        )}

        {isCollapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <span className="font-semibold text-sm">{entityName}</span>

        {/* Reviewed count */}
        {(() => {
          const reviewed = (statusCounts.get("accepted") || 0) + (statusCounts.get("excluded") || 0);
          return (
            <span className={cn(
              "text-[11px] font-medium px-1.5 py-0.5 rounded",
              reviewed === total && total > 0
                ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                : reviewed > 0
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                  : "bg-muted text-muted-foreground"
            )}>
              {reviewed}/{total} reviewed
            </span>
          );
        })()}

        {/* Status counts */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-1">
          {statusParts.map((part, i) => (
            <span key={part.label}>
              {i > 0 && <span className="mx-0.5">&middot;</span>}
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

        {/* Discuss entity button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/mapping/discuss-entity/${entityId}`);
          }}
          className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
          title="Discuss entity"
        >
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        </button>

        {/* Exclude entity from transfer review */}
        {onExcludeEntity && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExcludeEntity(entityId, entityName);
            }}
            className="shrink-0 px-2 py-0.5 rounded text-[10px] font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Mark entity as not needed for this transfer"
          >
            Not needed for ST
          </button>
        )}
      </div>

      {/* Body — collapsible, default open */}
      {!isCollapsed && (
        <div className="px-3 pb-3 space-y-1">
          {/* Parent's own cards */}
          {sortedCards.map((card) => (
            <ReviewCard
              key={card.id}
              card={card}
              onPunt={onPunt}
              onExclude={onExclude}
              onAcceptWithRipple={onAcceptWithRipple}
              currentUserId={currentUserId}
              onClaim={onClaim}
            />
          ))}

          {/* Child entity sub-sections */}
          {childGroups.map((child) => (
            <ChildEntitySection
              key={child.entityId}
              child={child}
              onPunt={onPunt}
              onExclude={onExclude}
              onAcceptWithRipple={onAcceptWithRipple}
              currentUserId={currentUserId}
              onClaim={onClaim}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChildEntitySection({
  child,
  onPunt,
  onExclude,
  onAcceptWithRipple,
  currentUserId,
  onClaim,
}: {
  child: ChildEntityGroup;
  onPunt: (card: ReviewCardData) => void;
  onExclude: (card: ReviewCardData) => void;
  onAcceptWithRipple?: (card: ReviewCardData) => void;
  currentUserId?: string | null;
  onClaim?: (mappingId: string, assigneeId: string | null) => void;
}) {
  const sorted = useMemo(() => sortCards(child.cards), [child.cards]);

  return (
    <div className="border-l-2 border-muted pl-3 mt-2">
      <div className="flex items-center gap-1.5 py-1.5 text-xs text-muted-foreground">
        <Component className="h-3 w-3 shrink-0" />
        <span className="font-medium">{child.entityName}</span>
        <span>&middot;</span>
        <span>{child.cards.length} fields</span>
      </div>
      <div className="space-y-1">
        {sorted.map((card) => (
          <ReviewCard
            key={card.id}
            card={card}
            onPunt={onPunt}
            onExclude={onExclude}
            onAcceptWithRipple={onAcceptWithRipple}
            currentUserId={currentUserId}
            onClaim={onClaim}
          />
        ))}
      </div>
    </div>
  );
}
