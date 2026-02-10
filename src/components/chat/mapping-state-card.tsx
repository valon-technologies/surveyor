"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CONFIDENCE_COLORS, MAPPING_TYPE_LABELS } from "@/lib/constants";
import type { ConfidenceLevel, MappingType } from "@/lib/constants";
import { Check } from "lucide-react";

interface MappingState {
  mappingType: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string> | null;
  reasoning: string | null;
  confidence: string | null;
  notes: string | null;
}

interface MappingStateCardProps {
  targetFieldName: string;
  entityName: string;
  mapping: MappingState;
  pendingUpdate: Record<string, unknown> | null;
  onApplyUpdate: (update: Record<string, unknown>) => void;
}

export function MappingStateCard({
  targetFieldName,
  entityName,
  mapping,
  pendingUpdate,
  onApplyUpdate,
}: MappingStateCardProps) {
  const confidenceColor = mapping.confidence
    ? CONFIDENCE_COLORS[mapping.confidence as ConfidenceLevel]
    : "#6b7280";
  const mappingTypeLabel = mapping.mappingType
    ? MAPPING_TYPE_LABELS[mapping.mappingType as MappingType]
    : "Unmapped";

  return (
    <div className="w-80 border-l flex flex-col overflow-y-auto">
      <Card className="border-0 rounded-none shadow-none flex-1">
        <CardHeader className="pb-3">
          <div className="space-y-1">
            <CardTitle className="text-sm">{targetFieldName}</CardTitle>
            <Badge variant="secondary" className="text-[10px]">
              {entityName}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Type" value={mappingTypeLabel} />
          <Row
            label="Confidence"
            value={
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: confidenceColor }}
                />
                {mapping.confidence || "—"}
              </span>
            }
          />
          <Row
            label="Source"
            value={
              mapping.sourceFieldName
                ? `${mapping.sourceEntityName || "?"}.${mapping.sourceFieldName}`
                : "—"
            }
          />
          {mapping.transform && (
            <div>
              <span className="text-xs text-muted-foreground">Transform</span>
              <code className="block text-xs bg-muted px-2 py-1 rounded mt-0.5">
                {mapping.transform}
              </code>
            </div>
          )}
          {mapping.defaultValue && (
            <Row label="Default" value={mapping.defaultValue} />
          )}
          {mapping.reasoning && (
            <div>
              <span className="text-xs text-muted-foreground">Reasoning</span>
              <p className="text-xs mt-0.5">{mapping.reasoning}</p>
            </div>
          )}
          {mapping.notes && (
            <div>
              <span className="text-xs text-muted-foreground">Notes</span>
              <p className="text-xs mt-0.5">{mapping.notes}</p>
            </div>
          )}

          {/* Pending update */}
          {pendingUpdate && (
            <div className="border-t pt-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-blue-600">
                  Proposed Update
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onApplyUpdate(pendingUpdate)}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Apply
                </Button>
              </div>
              <div className="space-y-1 text-xs bg-blue-50 dark:bg-blue-950/30 rounded p-2">
                {Object.entries(pendingUpdate).map(([key, val]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">
                      {key}:
                    </span>
                    <span className="text-blue-700 dark:text-blue-300 truncate">
                      {val === null ? "null" : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-right">{value}</span>
    </div>
  );
}
