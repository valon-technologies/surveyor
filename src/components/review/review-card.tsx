"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAcceptMapping, useExcludeMapping, useUndoReview } from "@/queries/review-queries";
import { CONFIDENCE_COLORS, MAPPING_TYPE_LABELS } from "@/lib/constants";
import type { ReviewCardData } from "@/types/review";
import type { ConfidenceLevel, MappingType } from "@/lib/constants";
import { MilestoneBadge } from "@/components/shared/tier-badge";
import { MessageSquare, Check, ArrowRight, ArchiveX, Undo2 } from "lucide-react";

/**
 * Build a complete SQL SELECT statement from the mapping data.
 * e.g. SELECT source_table.source_col AS target_col FROM source_table
 *      SELECT CAST(src.field AS DATE) AS target_col FROM src
 *      SELECT 'default_value' AS target_col  -- no source
 */
function buildSqlPreview(card: ReviewCardData): string | null {
  const targetCol = card.targetFieldName;
  const sourceTable = card.sourceEntityName;
  const sourceCol = card.sourceFieldName;
  const transform = card.transform;
  const defaultValue = card.defaultValue;

  // Nothing to show for unmapped fields with no info
  if (!sourceCol && !transform && !defaultValue) return null;

  let selectExpr: string;

  if (transform) {
    // Transform is a SQL expression — use it as the SELECT expression
    selectExpr = transform;
  } else if (sourceTable && sourceCol) {
    // Direct column reference
    selectExpr = `${sourceTable}.${sourceCol}`;
  } else if (sourceCol) {
    selectExpr = sourceCol;
  } else if (defaultValue) {
    // No source, just a default
    selectExpr = `'${defaultValue}'`;
  } else {
    return null;
  }

  // Build the full statement
  const parts: string[] = [];
  parts.push(`SELECT ${selectExpr} AS ${targetCol}`);

  if (sourceTable) {
    parts.push(`FROM ${sourceTable}`);
  }

  return parts.join("\n");
}

interface ReviewCardProps {
  card: ReviewCardData;
  onPunt: (card: ReviewCardData) => void;
}

export function ReviewCard({ card, onPunt }: ReviewCardProps) {
  const router = useRouter();
  const acceptMutation = useAcceptMapping();
  const excludeMutation = useExcludeMapping();
  const undoMutation = useUndoReview();

  const confidenceColor = card.confidence
    ? CONFIDENCE_COLORS[card.confidence as ConfidenceLevel]
    : "#6b7280";

  const mappingTypeLabel = card.mappingType
    ? MAPPING_TYPE_LABELS[card.mappingType as MappingType]
    : "Unmapped";

  const hasSource = card.sourceEntityName || card.sourceFieldName;

  // Build a complete SQL preview from the mapping data
  const sqlPreview = buildSqlPreview(card);

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: mapping detail */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Header: target table.field → source table.field */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: confidenceColor }}
                title={`Confidence: ${card.confidence || "unknown"}`}
              />
              <code className="text-sm font-semibold text-foreground">
                {card.entityName}.{card.targetFieldName}
              </code>
              {card.targetFieldDataType && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {card.targetFieldDataType}
                </span>
              )}
              {hasSource && (
                <>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mx-0.5" />
                  <code className="text-sm text-muted-foreground">
                    {card.sourceEntityName || "?"}.{card.sourceFieldName || "?"}
                  </code>
                </>
              )}
            </div>

            {/* Mapping type + confidence + milestone */}
            <div className="flex items-center gap-2">
              <MilestoneBadge milestone={card.milestone} />
              <Badge variant="outline" className="text-[10px] font-normal">
                {mappingTypeLabel}
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px] font-normal"
                style={{ borderColor: confidenceColor, color: confidenceColor }}
              >
                {card.confidence || "unknown"}
              </Badge>
              {card.defaultValue && (
                <span className="text-[10px] text-muted-foreground">
                  default: <code>{card.defaultValue}</code>
                </span>
              )}
            </div>

            {/* SQL preview — complete SELECT statement */}
            {sqlPreview && (
              <div className="bg-muted rounded px-2.5 py-1.5">
                <code className="text-xs text-foreground whitespace-pre-wrap break-all">
                  {sqlPreview}
                </code>
              </div>
            )}

            {/* Reasoning */}
            {card.reasoning && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {card.reasoning}
              </p>
            )}

            {/* Notes — often contain caveats or open questions */}
            {card.notes && (
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                {card.notes}
              </p>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                router.push(`/mapping/discuss/${card.id}`)
              }
              title="Discuss with AI"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-green-600 hover:text-green-700 hover:bg-green-50"
              onClick={() => acceptMutation.mutate(card.id)}
              disabled={acceptMutation.isPending}
              title="Accept mapping"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              onClick={() => onPunt(card)}
              title="Punt / delegate"
            >
              Punt
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-stone-500 hover:text-stone-600 hover:bg-stone-50"
              onClick={() => excludeMutation.mutate(card.id)}
              disabled={excludeMutation.isPending}
              title="Exclude — not needed"
            >
              <ArchiveX className="h-4 w-4" />
            </Button>
            {card.reviewStatus && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => undoMutation.mutate(card.id)}
                disabled={undoMutation.isPending}
                title="Undo review action"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Review status indicator */}
        {card.reviewStatus && (
          <div className="mt-2 pt-2 border-t">
            <Badge
              variant={
                card.reviewStatus === "accepted"
                  ? "default"
                  : card.reviewStatus === "punted"
                    ? "secondary"
                    : "outline"
              }
              className="text-[10px]"
            >
              {card.reviewStatus}
            </Badge>
            {card.puntNote && (
              <span className="text-xs text-muted-foreground ml-2">
                {card.puntNote}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
