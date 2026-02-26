"use client";

import { cn } from "@/lib/utils";

interface AccuracyBadgeProps {
  pct: number | null;
  label?: string;
  size?: "sm" | "md";
}

function getColor(pct: number): string {
  if (pct >= 70) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (pct >= 40) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-red-100 text-red-800 border-red-200";
}

export function AccuracyBadge({ pct, label, size = "sm" }: AccuracyBadgeProps) {
  if (pct === null) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md border px-1.5 py-0.5 font-medium",
          "bg-muted text-muted-foreground border-border",
          size === "sm" ? "text-[10px]" : "text-xs",
        )}
      >
        No SOT
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium",
        getColor(pct),
        size === "sm" ? "text-[10px]" : "text-xs",
      )}
      title={label ? `${label}: ${pct}%` : `${pct}% source accuracy`}
    >
      {label && <span className="opacity-70">{label}</span>}
      {pct.toFixed(1)}%
    </span>
  );
}

interface SourceMatchBadgeProps {
  matchType: string;
}

const MATCH_COLORS: Record<string, string> = {
  EXACT: "bg-emerald-100 text-emerald-800 border-emerald-200",
  BOTH_NULL: "bg-emerald-100 text-emerald-800 border-emerald-200",
  SUBSET: "bg-amber-100 text-amber-800 border-amber-200",
  SUPERSET: "bg-amber-100 text-amber-800 border-amber-200",
  OVERLAP: "bg-amber-100 text-amber-800 border-amber-200",
  DISJOINT: "bg-red-100 text-red-800 border-red-200",
  NO_GEN: "bg-red-100 text-red-800 border-red-200",
  SOT_NULL: "bg-gray-100 text-gray-600 border-gray-200",
  NO_SOT: "bg-gray-100 text-gray-600 border-gray-200",
};

export function SourceMatchBadge({ matchType }: SourceMatchBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        MATCH_COLORS[matchType] || "bg-gray-100 text-gray-600 border-gray-200",
      )}
    >
      {matchType}
    </span>
  );
}
