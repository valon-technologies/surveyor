"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CONFIDENCE_COLORS,
  MAPPING_TYPE_LABELS,
} from "@/lib/constants";
import type { ConfidenceLevel, MappingType } from "@/lib/constants";
import { ArrowRight, Check } from "lucide-react";

export interface MappingState {
  mappingType: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string | null> | null;
  reasoning: string | null;
  confidence: string | null;
  notes: string | null;
}

/** Human-readable labels for mapping-update keys */
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
  question: "Question for Client",
};

const HIDDEN_UPDATE_KEYS = new Set(["sourceEntityId", "sourceFieldId"]);

// ─── Current Mapping Summary (no proposed update) ───────────

interface MappingSummaryProps {
  targetFieldName: string;
  mapping: MappingState;
}

export function MappingSummary({ targetFieldName, mapping }: MappingSummaryProps) {
  const confidenceColor = mapping.confidence
    ? CONFIDENCE_COLORS[mapping.confidence as ConfidenceLevel]
    : "#6b7280";
  const mappingTypeLabel = mapping.mappingType
    ? MAPPING_TYPE_LABELS[mapping.mappingType as MappingType]
    : "Unmapped";
  const sourceDisplay = mapping.sourceFieldName
    ? `${mapping.sourceEntityName || "?"}.${mapping.sourceFieldName}`
    : null;

  return (
    <div className="px-4 py-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Current Mapping</span>
        <Badge
          variant="outline"
          className="text-[10px] font-medium"
          style={{ borderColor: confidenceColor, color: confidenceColor }}
        >
          {mapping.confidence ? `${mapping.confidence} confidence` : "unset"}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {mappingTypeLabel}
        </Badge>
      </div>

      <div className="flex gap-4 text-[11px]">
        {/* Left: source, target, reasoning */}
        <div className="w-1/3 space-y-0.5">
          <div>
            <span className="text-muted-foreground font-medium">Source: </span>
            <code className="font-mono break-words">{sourceDisplay || "— unmapped —"}</code>
          </div>
          <div>
            <span className="text-muted-foreground font-medium">Target: </span>
            <code className="font-mono break-words">{targetFieldName}</code>
          </div>
          {mapping.reasoning && (
            <div>
              <span className="text-muted-foreground font-medium">Reasoning: </span>
              <span className="text-muted-foreground break-words">{mapping.reasoning}</span>
            </div>
          )}
        </div>
        {/* Right: transform */}
        <div className="w-2/3 min-w-0">
          {mapping.transform ? (
            <>
              <span className="text-muted-foreground font-medium">Transform:</span>
              <code className="block font-mono whitespace-pre-wrap break-words bg-muted/50 rounded px-2 py-1 mt-0.5">{
                mapping.transform
                  .replace(/\b(SELECT|FROM|WHERE|CASE|WHEN|ELSE|END)\b/gi, (match) => `\n${match}`)
                  .replace(/^\n/, '')
              }</code>
            </>
          ) : (
            <span className="text-muted-foreground font-medium">Transform: direct (identity)</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Proposed Update Card ───────────────────────────────────

interface ProposedUpdateCardProps {
  pendingUpdate: Record<string, unknown>;
  onApplyUpdate: (update: Record<string, unknown>) => void;
  applied?: boolean;
}

export function ProposedUpdateCard({ pendingUpdate, onApplyUpdate, applied }: ProposedUpdateCardProps) {
  const colorClass = applied ? "text-green-700 dark:text-green-300" : "text-blue-700 dark:text-blue-300";
  const borderClass = applied ? "border-green-200 dark:border-green-800" : "border-blue-200 dark:border-blue-800";
  const bgClass = applied ? "bg-green-50 dark:bg-green-950/40" : "bg-blue-50 dark:bg-blue-950/40";

  // Group fields by section
  const sourceKeys = ["sourceEntityName", "sourceFieldName"];
  const transformKeys = ["mappingType", "transform", "defaultValue", "enumMapping"];
  const questionKeys = ["question"];
  const metaKeys = ["reasoning", "confidence", "notes"];

  const renderField = (key: string, val: unknown) => (
    <div key={key}>
      <span className="text-muted-foreground text-[11px] font-medium">
        {UPDATE_KEY_LABELS[key] || key}:
      </span>{" "}
      <span className={`break-words whitespace-pre-wrap ${colorClass}`}>
        {String(val)}
      </span>
    </div>
  );

  const entries = Object.entries(pendingUpdate)
    .filter(([key]) => !HIDDEN_UPDATE_KEYS.has(key))
    .filter(([, val]) => val !== null && val !== undefined);

  const sourceEntries = entries.filter(([k]) => sourceKeys.includes(k));
  const transformEntries = entries.filter(([k]) => transformKeys.includes(k));
  const questionEntries = entries.filter(([k]) => questionKeys.includes(k));
  const metaEntries = entries.filter(([k]) => metaKeys.includes(k));

  return (
    <div className={`m-3 border rounded-lg overflow-hidden ${borderClass}`}>
      <div className={`flex items-center justify-between px-3 py-1.5 ${bgClass}`}>
        <span className={`text-xs font-semibold ${colorClass}`}>
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
      <div className="px-3 py-1.5 space-y-2 text-xs">
        {sourceEntries.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Source</span>
            <div className="mt-0.5 space-y-0.5">{sourceEntries.map(([k, v]) => renderField(k, v))}</div>
          </div>
        )}
        {transformEntries.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Transform</span>
            <div className="mt-0.5 space-y-0.5">{transformEntries.map(([k, v]) => renderField(k, v))}</div>
          </div>
        )}
        {questionEntries.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Question for Client</span>
            <div className="mt-0.5 space-y-0.5">{questionEntries.map(([k, v]) => renderField(k, v))}</div>
          </div>
        )}
        {metaEntries.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Meta</span>
            <div className="mt-0.5 space-y-0.5">{metaEntries.map(([k, v]) => renderField(k, v))}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Combined Card (backwards compat) ───────────────────────

interface MappingStateCardProps {
  targetFieldName: string;
  entityName: string;
  mapping: MappingState;
  pendingUpdate: Record<string, unknown> | null;
  onApplyUpdate: (update: Record<string, unknown>) => void;
  applied?: boolean;
}

export function MappingStateCard({
  targetFieldName,
  mapping,
  pendingUpdate,
  onApplyUpdate,
  applied,
}: MappingStateCardProps) {
  return (
    <div className="bg-muted/20">
      <MappingSummary targetFieldName={targetFieldName} mapping={mapping} />
      {pendingUpdate && (
        <ProposedUpdateCard
          pendingUpdate={pendingUpdate}
          onApplyUpdate={onApplyUpdate}
          applied={applied}
        />
      )}
    </div>
  );
}
