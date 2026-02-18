"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CONFIDENCE_COLORS,
  MAPPING_TYPE_LABELS,
  MAPPING_TYPE_DESCRIPTIONS,
} from "@/lib/constants";
import type { ConfidenceLevel, MappingType } from "@/lib/constants";
import { ArrowRight, Check } from "lucide-react";

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
  applied?: boolean;
}

/** Human-readable labels for mapping-update keys shown in the proposed update panel */
const UPDATE_KEY_LABELS: Record<string, string> = {
  mappingType: "Type",
  sourceEntityName: "Source Entity",
  sourceFieldName: "Source Field",
  sourceEntityId: "Source Entity ID",
  sourceFieldId: "Source Field ID",
  transform: "Transform",
  defaultValue: "Default",
  enumMapping: "Enum Mapping",
  reasoning: "Reasoning",
  confidence: "Confidence",
  notes: "Notes",
};

/** Keys to hide from the proposed update panel (internal IDs) */
const HIDDEN_UPDATE_KEYS = new Set(["sourceEntityId", "sourceFieldId"]);

export function MappingStateCard({
  targetFieldName,
  entityName,
  mapping,
  pendingUpdate,
  onApplyUpdate,
  applied,
}: MappingStateCardProps) {
  const confidenceColor = mapping.confidence
    ? CONFIDENCE_COLORS[mapping.confidence as ConfidenceLevel]
    : "#6b7280";
  const mappingTypeLabel = mapping.mappingType
    ? MAPPING_TYPE_LABELS[mapping.mappingType as MappingType]
    : "Unmapped";
  const mappingTypeDesc = mapping.mappingType
    ? MAPPING_TYPE_DESCRIPTIONS[mapping.mappingType as MappingType]
    : null;

  const sourceDisplay = mapping.sourceFieldName
    ? `${mapping.sourceEntityName || "?"}.${mapping.sourceFieldName}`
    : null;

  return (
    <div className="flex flex-col flex-1 bg-muted/20">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-background">
        <p className="text-sm font-mono font-semibold text-foreground">
          <span className="text-muted-foreground">{entityName}.</span>
          {targetFieldName}
        </p>
      </div>

      <div className="flex-1 px-4 py-3 space-y-4">
        {/* Mapping summary */}
        <Section title="Mapping">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[10px] font-medium"
              style={{
                borderColor: confidenceColor,
                color: confidenceColor,
              }}
            >
              {mapping.confidence || "unset"}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {mappingTypeLabel}
            </Badge>
          </div>
          {mappingTypeDesc && (
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              {mappingTypeDesc}
            </p>
          )}
        </Section>

        {/* Source */}
        <Section title="Source">
          {sourceDisplay ? (
            <div className="flex items-center gap-2 text-xs">
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                {sourceDisplay}
              </code>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono truncate">
                {targetFieldName}
              </code>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No source mapped</p>
          )}
        </Section>

        {/* Transform / Default */}
        {(mapping.transform || mapping.defaultValue) && (
          <Section title="Transform">
            {mapping.transform && (
              <code className="block text-xs bg-muted px-2 py-1.5 rounded font-mono whitespace-pre-wrap">
                {mapping.transform}
              </code>
            )}
            {mapping.defaultValue && (
              <div className="flex items-center gap-2 text-xs mt-1.5">
                <span className="text-muted-foreground">Default:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                  {mapping.defaultValue}
                </code>
              </div>
            )}
          </Section>
        )}

        {/* Reasoning */}
        {mapping.reasoning && (
          <Section title="Reasoning">
            <p className="text-xs leading-relaxed">{mapping.reasoning}</p>
          </Section>
        )}

        {/* Notes */}
        {mapping.notes && (
          <Section title="Notes">
            <p className="text-xs leading-relaxed">{mapping.notes}</p>
          </Section>
        )}

        {/* Pending update */}
        {pendingUpdate && (
          <div className={`border rounded-lg overflow-hidden ${applied ? "border-green-200 dark:border-green-800" : "border-blue-200 dark:border-blue-800"}`}>
            <div className={`flex items-center justify-between px-3 py-2 ${applied ? "bg-green-50 dark:bg-green-950/40" : "bg-blue-50 dark:bg-blue-950/40"}`}>
              <span className={`text-xs font-semibold ${applied ? "text-green-700 dark:text-green-300" : "text-blue-700 dark:text-blue-300"}`}>
                {applied ? "Update Applied" : "Proposed Update"}
              </span>
              {!applied && (
                <Button
                  size="sm"
                  className="h-6 text-[11px] bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => onApplyUpdate(pendingUpdate)}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Apply
                </Button>
              )}
              {applied && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-300">
                  <Check className="h-3 w-3" />
                  Applied
                </span>
              )}
            </div>
            <div className="px-3 py-2 space-y-1.5 text-xs">
              {Object.entries(pendingUpdate)
                .filter(([key]) => !HIDDEN_UPDATE_KEYS.has(key))
                .map(([key, val]) => (
                  <div key={key}>
                    <span className="text-muted-foreground text-[11px]">
                      {UPDATE_KEY_LABELS[key] || key}
                    </span>
                    <p className={`mt-0.5 break-words ${applied ? "text-green-700 dark:text-green-300" : "text-blue-700 dark:text-blue-300"}`}>
                      {val === null ? "null" : String(val)}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
        {title}
      </h4>
      {children}
    </div>
  );
}
