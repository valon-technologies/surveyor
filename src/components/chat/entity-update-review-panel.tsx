"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, ChevronDown, ChevronRight } from "lucide-react";
import type { EntityMappingUpdate } from "@/types/chat";

interface EntityUpdateReviewPanelProps {
  updates: Record<string, unknown>[];
  onApply: (selectedUpdates: EntityMappingUpdate[]) => void;
  onDismiss: () => void;
  applying?: boolean;
  applied?: boolean;
  applyResult?: { applied: number; errors: string[] } | null;
}

const HIDDEN_KEYS = new Set(["sourceEntityId", "sourceFieldId"]);

const KEY_LABELS: Record<string, string> = {
  targetFieldName: "Field",
  mappingType: "Type",
  sourceEntityName: "Source Table",
  sourceFieldName: "Source Field",
  transform: "Transform",
  defaultValue: "Default",
  reasoning: "Reasoning",
  confidence: "Confidence",
  notes: "Notes",
};

export function EntityUpdateReviewPanel({
  updates,
  onApply,
  onDismiss,
  applying,
  applied,
  applyResult,
}: EntityUpdateReviewPanelProps) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(updates.map((_, i) => i))
  );
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === updates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(updates.map((_, i) => i)));
    }
  };

  const handleApply = () => {
    const selectedUpdates = updates
      .filter((_, i) => selected.has(i))
      .map((u) => u as unknown as EntityMappingUpdate);
    onApply(selectedUpdates);
  };

  if (applied && applyResult) {
    return (
      <div className="border-t">
        <div className="px-4 py-3 bg-green-50 dark:bg-green-950/30">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
            <Check className="h-4 w-4" />
            {applyResult.applied} update{applyResult.applied !== 1 ? "s" : ""}{" "}
            applied
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {applyResult.errors.map((err, i) => (
                <p
                  key={i}
                  className="text-xs text-red-600 dark:text-red-400"
                >
                  {err}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-800">
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
          {updates.length} Proposed Update{updates.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] text-muted-foreground"
            onClick={onDismiss}
            disabled={applying}
          >
            <X className="h-3 w-3 mr-0.5" />
            Dismiss
          </Button>
          <Button
            size="sm"
            className="h-6 text-[11px] bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleApply}
            disabled={applying || selected.size === 0}
          >
            <Check className="h-3 w-3 mr-0.5" />
            {selected.size === updates.length
              ? "Apply All"
              : `Apply ${selected.size}`}
          </Button>
        </div>
      </div>

      {/* Select all toggle */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={selected.size === updates.length}
          onChange={toggleAll}
          className="rounded border-muted-foreground/30"
        />
        <span>
          {selected.size}/{updates.length} selected
        </span>
      </div>

      {/* Update list */}
      <div className="max-h-[350px] overflow-y-auto">
        {updates.map((update, idx) => {
          const fieldName =
            (update.targetFieldName as string) || `Update ${idx + 1}`;
          const isSelected = selected.has(idx);
          const isExpanded = expandedIdx === idx;
          const srcEntity = update.sourceEntityName as string | undefined;
          const srcField = update.sourceFieldName as string | undefined;
          const sourceInfo: string | null =
            srcEntity && srcField
              ? `${srcEntity}.${srcField}`
              : srcEntity || null;

          return (
            <div
              key={idx}
              className={`border-b last:border-b-0 ${
                isSelected
                  ? "bg-blue-50/50 dark:bg-blue-950/20"
                  : "bg-background opacity-60"
              }`}
            >
              {/* Summary row */}
              <div className="flex items-center gap-2 px-4 py-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(idx)}
                  className="rounded border-muted-foreground/30 shrink-0"
                />
                <button
                  onClick={() =>
                    setExpandedIdx(isExpanded ? null : idx)
                  }
                  className="flex items-center gap-1 min-w-0 flex-1 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-mono text-xs font-medium truncate">
                    {fieldName}
                  </span>
                </button>
                {sourceInfo && (
                  <code className="text-[10px] text-muted-foreground font-mono bg-muted px-1 py-0.5 rounded truncate max-w-[120px] shrink-0">
                    {sourceInfo}
                  </code>
                )}
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-4 pb-2 pl-10 space-y-1 text-xs">
                  {Object.entries(update)
                    .filter(
                      ([key]) =>
                        !HIDDEN_KEYS.has(key) &&
                        key !== "targetFieldName"
                    )
                    .map(([key, val]) => (
                      <div key={key}>
                        <span className="text-muted-foreground text-[11px]">
                          {KEY_LABELS[key] || key}:
                        </span>{" "}
                        <span className="text-blue-700 dark:text-blue-300 break-words">
                          {val === null ? "null" : String(val)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
