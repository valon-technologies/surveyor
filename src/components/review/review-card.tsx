"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAcceptMapping, useUndoReview, useReassignMapping } from "@/queries/review-queries";
import { useWorkspaceMembers } from "@/queries/member-queries";
import { CONFIDENCE_COLORS, MAPPING_TYPE_LABELS, MAPPING_STATUS_LABELS, MAPPING_STATUS_COLORS } from "@/lib/constants";
import type { ReviewCardData } from "@/types/review";
import type { ConfidenceLevel, MappingType, MappingStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { stripCitations } from "@/lib/generation/citation-parser";
import { MessageSquare, Check, ArrowRight, Ban, Undo2, ChevronRight, ChevronDown, UserCircle, UserCheck } from "lucide-react";

interface ReviewCardProps {
  card: ReviewCardData;
  onPunt: (card: ReviewCardData) => void;
  onExclude: (card: ReviewCardData) => void;
  onAcceptWithRipple?: (card: ReviewCardData) => void;
  currentUserId?: string | null;
  onClaim?: (mappingId: string, assigneeId: string | null) => void;
}

function buildSqlPreview(card: ReviewCardData): string | null {
  if (!card.sourceFieldName && !card.transform && !card.defaultValue) return null;

  if (card.transform) return card.transform;

  const src = card.sourceEntityName && card.sourceFieldName
    ? `${card.sourceEntityName}.${card.sourceFieldName}`
    : card.sourceFieldName || null;

  if (!src) return card.defaultValue ? `DEFAULT ${card.defaultValue}` : null;

  const target = `${card.entityName}.${card.targetFieldName}`;
  return `${target} ← ${src}`;
}

export function ReviewCard({ card, onPunt, onExclude, onAcceptWithRipple, currentUserId, onClaim }: ReviewCardProps) {
  const router = useRouter();
  const acceptMutation = useAcceptMapping();
  const undoMutation = useUndoReview();
  const reassignMutation = useReassignMapping();
  const { data: members } = useWorkspaceMembers();
  const [expanded, setExpanded] = useState(false);
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!assignDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAssignDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [assignDropdownOpen]);

  const isExcluded = card.status === "excluded";
  const isAccepted = card.status === "accepted";
  const isPunted = card.status === "punted";
  const showUndo = isAccepted || isPunted || card.status === "needs_discussion" || isExcluded;

  const confidenceColor = card.confidence
    ? CONFIDENCE_COLORS[card.confidence as ConfidenceLevel]
    : "#6b7280";

  const mappingTypeLabel = card.mappingType
    ? MAPPING_TYPE_LABELS[card.mappingType as MappingType]
    : "Unmapped";

  const isUnmapped = card.status === "unmapped";
  const hasSource = card.sourceEntityName || card.sourceFieldName;
  const sqlPreview = buildSqlPreview(card);
  const hasExpandableDetails = card.notes || card.puntNote;
  const hasMappingSummary = sqlPreview || card.reasoning || card.defaultValue;

  // Excluded: dim row, only show undo
  if (isExcluded) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 text-muted-foreground">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0" />
        <code className="text-xs line-through">
          {card.targetFieldName}
        </code>
        <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-400">
          Excluded
        </Badge>
        {card.excludeReason && (
          <span className="text-[11px] text-stone-400 truncate max-w-[200px]" title={card.excludeReason}>
            {card.excludeReason}
          </span>
        )}
        <span className="ml-auto" />
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={() => undoMutation.mutate(card.id)}
          disabled={undoMutation.isPending}
          title="Undo exclude"
        >
          <Undo2 className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        isAccepted
          ? "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900"
          : isPunted
            ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900"
            : "bg-background border-border hover:border-foreground/20"
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-3 py-2">
        {/* Claim checkbox */}
        {onClaim && currentUserId && (() => {
          const isMine = card.assigneeId === currentUserId;
          const claimedByOther = card.assigneeId && card.assigneeId !== currentUserId;
          if (claimedByOther) {
            return (
              <span title={`Claimed by ${card.assigneeName}`} className="shrink-0">
                <UserCheck className="h-3.5 w-3.5 text-amber-500" />
              </span>
            );
          }
          return (
            <input
              type="checkbox"
              checked={!!isMine}
              onChange={() => onClaim(card.id, isMine ? null : currentUserId)}
              title={isMine ? "Release this field" : "Claim for review"}
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary cursor-pointer shrink-0"
            />
          );
        })()}

        {/* Expand toggle (for notes/punt note) */}
        {hasExpandableDetails ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {/* Confidence dot */}
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: confidenceColor }}
          title={`${card.confidence || "unknown"} confidence`}
        />

        {/* Field name */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <code className="text-xs font-semibold text-foreground truncate">
            {card.targetFieldName}
          </code>
          {card.targetFieldDataType && (
            <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">
              {card.targetFieldDataType}
            </span>
          )}
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-[10px] font-normal h-5">
            {mappingTypeLabel}
          </Badge>
          {card.status !== "unmapped" && card.status !== "unreviewed" && (
            <Badge
              variant="outline"
              className="text-[10px] h-5"
              style={{
                borderColor: MAPPING_STATUS_COLORS[card.status as MappingStatus],
                color: MAPPING_STATUS_COLORS[card.status as MappingStatus],
              }}
            >
              {MAPPING_STATUS_LABELS[card.status as MappingStatus] || card.status}
            </Badge>
          )}
        </div>

        {/* Assignee chip */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setAssignDropdownOpen(!assignDropdownOpen)}
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors border",
              card.assigneeName
                ? "bg-accent border-foreground/10 text-foreground"
                : "border-dashed border-muted-foreground/30 text-muted-foreground hover:border-foreground/20"
            )}
            title={card.assigneeName ? `Assigned to ${card.assigneeName}` : "Unassigned — click to assign"}
          >
            <UserCircle className="h-3 w-3" />
            <span className="max-w-[80px] truncate">
              {card.assigneeName || "Unassigned"}
            </span>
          </button>

          {assignDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]">
              {/* Unassign option */}
              {card.assigneeId && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-muted-foreground"
                  onClick={() => {
                    reassignMutation.mutate({ mappingId: card.id, assigneeId: null });
                    setAssignDropdownOpen(false);
                  }}
                >
                  Unassign
                </button>
              )}
              {/* Member list */}
              {members
                ?.filter((m) => m.userId !== card.assigneeId)
                .map((m) => (
                  <button
                    key={m.userId}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                    onClick={() => {
                      reassignMutation.mutate({ mappingId: card.id, assigneeId: m.userId });
                      setAssignDropdownOpen(false);
                    }}
                  >
                    {m.name || m.email}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {showUndo && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => undoMutation.mutate(card.id)}
              disabled={undoMutation.isPending}
              title="Undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => router.push(`/mapping/discuss/${card.id}`)}
            title="Discuss"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Always-visible mapping summary */}
      {hasMappingSummary && (
        <div className="px-3 pb-2 ml-9 space-y-1">
          {sqlPreview && (
            <pre className="text-xs font-mono text-foreground/80 bg-muted/50 rounded px-2 py-1 whitespace-pre-wrap break-all">
              {sqlPreview}
            </pre>
          )}
          {!sqlPreview && card.defaultValue && (
            <code className="text-xs text-foreground/80 bg-muted/50 rounded px-2 py-1 block">
              DEFAULT {card.defaultValue}
            </code>
          )}
          {card.reasoning && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {stripCitations(card.reasoning)}
            </p>
          )}
          {card.notes && card.confidence !== "high" && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1 mt-1">
              {card.notes}
            </p>
          )}
        </div>
      )}

      {/* Expandable extras (notes, punt note) */}
      {expanded && hasExpandableDetails && (
        <div className="px-3 pb-3 ml-9 space-y-1.5 border-t border-border/50 pt-2">
          {card.notes && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-amber-600">Notes</span>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{card.notes}</p>
            </div>
          )}
          {card.puntNote && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-amber-600">Punt Note</span>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{card.puntNote}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
