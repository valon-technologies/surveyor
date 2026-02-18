"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAcceptMapping, useUndoReview } from "@/queries/review-queries";
import { CONFIDENCE_COLORS, MAPPING_TYPE_LABELS, MAPPING_STATUS_LABELS, MAPPING_STATUS_COLORS } from "@/lib/constants";
import type { ReviewCardData } from "@/types/review";
import type { ConfidenceLevel, MappingType, MappingStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { MessageSquare, Check, ArrowRight, Ban, Undo2, ChevronRight, ChevronDown } from "lucide-react";

interface ReviewCardProps {
  card: ReviewCardData;
  onPunt: (card: ReviewCardData) => void;
  onExclude: (card: ReviewCardData) => void;
  onAcceptWithRipple?: (card: ReviewCardData) => void;
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

export function ReviewCard({ card, onPunt, onExclude, onAcceptWithRipple }: ReviewCardProps) {
  const router = useRouter();
  const acceptMutation = useAcceptMapping();
  const undoMutation = useUndoReview();
  const [expanded, setExpanded] = useState(false);

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
          title={`Confidence: ${card.confidence || "unknown"}`}
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

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {showUndo ? (
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
          ) : (
            <>
              {!isUnmapped && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                  onClick={() =>
                    acceptMutation.mutateAsync(card.id).then(() => onAcceptWithRipple?.(card))
                  }
                  disabled={acceptMutation.isPending}
                  title="Accept"
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onExclude(card)}
                title="Exclude"
              >
                <Ban className="h-3.5 w-3.5" />
              </Button>
            </>
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
              {card.reasoning}
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
