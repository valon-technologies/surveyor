"use client";

import { Button } from "@/components/ui/button";
import { Check, X, GitBranch } from "lucide-react";
import type { PipelineStructureUpdate } from "@/types/pipeline";

interface PipelineStructureReviewPanelProps {
  update: PipelineStructureUpdate;
  onApply: () => void;
  onDismiss: () => void;
  applying?: boolean;
  applied?: boolean;
  applyResult?: { success: boolean; changes: string[] } | null;
}

function describeChanges(update: PipelineStructureUpdate): string[] {
  const lines: string[] = [];

  if (update.structureType) {
    lines.push(`Change structure to "${update.structureType}"`);
  }

  if (update.addSources) {
    for (const src of update.addSources) {
      lines.push(`Add source: \`${src.table}\` as \`${src.alias}\``);
    }
  }

  if (update.removeSources) {
    for (const alias of update.removeSources) {
      lines.push(`Remove source: \`${alias}\``);
    }
  }

  if (update.addJoins) {
    for (const j of update.addJoins) {
      lines.push(
        `Add join: ${j.left} ${j.how.toUpperCase()} JOIN ${j.right} ON ${j.on.join(", ")}`
      );
    }
  }

  if (update.removeJoins) {
    for (const j of update.removeJoins) {
      lines.push(`Remove join: ${j.left} <-> ${j.right}`);
    }
  }

  if (update.updateJoins) {
    for (const j of update.updateJoins) {
      const parts = [];
      if (j.on) parts.push(`ON ${j.on.join(", ")}`);
      if (j.how) parts.push(`${j.how.toUpperCase()}`);
      lines.push(`Update join: ${j.left} <-> ${j.right} (${parts.join(", ")})`);
    }
  }

  if (update.concat !== undefined) {
    if (update.concat === null) {
      lines.push("Remove concat/union configuration");
    } else {
      lines.push(`Set concat: ${update.concat.sources.join(", ")}`);
    }
  }

  return lines;
}

export function PipelineStructureReviewPanel({
  update,
  onApply,
  onDismiss,
  applying,
  applied,
  applyResult,
}: PipelineStructureReviewPanelProps) {
  const changes = describeChanges(update);

  if (applied && applyResult) {
    return (
      <div className="border-t">
        <div className="px-4 py-3 bg-green-50 dark:bg-green-950/30">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
            <Check className="h-4 w-4" />
            Pipeline structure updated
          </div>
          {applyResult.changes.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {applyResult.changes.map((c, i) => (
                <p
                  key={i}
                  className="text-xs text-green-600 dark:text-green-400"
                >
                  {c}
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
      <div className="flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
            Pipeline Structure Change
          </span>
        </div>
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
            className="h-6 text-[11px] bg-amber-600 hover:bg-amber-700 text-white"
            onClick={onApply}
            disabled={applying}
          >
            <Check className="h-3 w-3 mr-0.5" />
            {applying ? "Applying..." : "Apply"}
          </Button>
        </div>
      </div>

      {/* Change list */}
      <div className="px-4 py-2.5 space-y-1.5">
        {changes.map((line, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-xs"
          >
            <span className="text-amber-500 mt-0.5 shrink-0">*</span>
            <span className="text-foreground font-mono break-all">
              {line}
            </span>
          </div>
        ))}
      </div>

      {/* Reasoning */}
      {update.reasoning && (
        <div className="px-4 pb-3 pt-0">
          <p className="text-[11px] text-muted-foreground italic">
            {update.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
