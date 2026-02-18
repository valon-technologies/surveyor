"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  ArrowRight,
  LayoutList,
  MessageSquare,
} from "lucide-react";
import {
  CONFIDENCE_COLORS,
  MAPPING_STATUS_COLORS,
  type ConfidenceLevel,
  type MappingStatus,
} from "@/lib/constants";

interface SiblingField {
  fieldName: string;
  dataType: string | null;
  mappingId: string | null;
  status: MappingStatus | "unmapped";
  confidence: string | null;
}

interface SessionCompleteCardProps {
  entityName: string;
  totalFields: number;
  completedFields: number;
  nextFields: SiblingField[];
  onNavigateToField: (mappingId: string) => void;
  onBackToQueue: () => void;
}

export function SessionCompleteCard({
  entityName,
  totalFields,
  completedFields,
  nextFields,
  onNavigateToField,
  onBackToQueue,
}: SessionCompleteCardProps) {
  const progress = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 0;

  return (
    <div className="mx-3 mb-3 rounded-lg border border-green-200 dark:border-green-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 dark:bg-green-950/40">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        <span className="text-sm font-semibold text-green-700 dark:text-green-300">
          Mapping Applied
        </span>
      </div>

      <div className="px-3 py-3 space-y-3">
        {/* Progress */}
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>{entityName}</span>
            <span>{completedFields}/{totalFields} fields</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Next fields */}
        {nextFields.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Next up
            </p>
            {nextFields.map((f) => {
              const statusColor = f.status === "unmapped"
                ? MAPPING_STATUS_COLORS.unmapped
                : f.confidence
                  ? CONFIDENCE_COLORS[f.confidence as ConfidenceLevel] ?? "#6b7280"
                  : MAPPING_STATUS_COLORS[f.status as MappingStatus] ?? "#6b7280";

              return (
                <button
                  key={f.fieldName}
                  onClick={() => f.mappingId && onNavigateToField(f.mappingId)}
                  disabled={!f.mappingId}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border bg-background hover:bg-muted/50 transition-colors text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-medium truncate">
                        {f.fieldName}
                      </span>
                      {f.dataType && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {f.dataType}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge
                        variant="outline"
                        className="text-[9px] h-4 px-1"
                        style={{ borderColor: statusColor, color: statusColor }}
                      >
                        {f.status === "unmapped" ? "unmapped" : f.confidence ? `${f.status} (${f.confidence})` : f.status}
                      </Badge>
                    </div>
                  </div>
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
                </button>
              );
            })}
          </div>
        )}

        {/* Back to queue */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onBackToQueue}
        >
          <LayoutList className="h-3.5 w-3.5 mr-1.5" />
          Back to review queue
        </Button>
      </div>
    </div>
  );
}
