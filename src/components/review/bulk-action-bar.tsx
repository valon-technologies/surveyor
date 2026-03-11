"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspaceMembers } from "@/queries/member-queries";
import type { ReviewCardData } from "@/types/review";
import { UserPlus, Ban, X, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  selectedIds: Set<string>;
  allCards: ReviewCardData[];
  currentUserId: string | null;
  onBulkAssign: (mappingIds: string[], assigneeId: string | null) => void;
  onBulkExclude: (mappingIds: string[], reason?: string) => void;
  onClearSelection: () => void;
  isPending: boolean;
}

export function BulkActionBar({
  selectedIds,
  allCards,
  currentUserId,
  onBulkAssign,
  onBulkExclude,
  onClearSelection,
  isPending,
}: BulkActionBarProps) {
  const { data: members } = useWorkspaceMembers();
  const [assignOpen, setAssignOpen] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState("");
  const assignRef = useRef<HTMLDivElement>(null);
  const excludeRef = useRef<HTMLDivElement>(null);

  const assignableMembers = (members || []).filter(
    (m) => m.role === "editor" || m.role === "owner"
  );

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (assignRef.current && !assignRef.current.contains(e.target as Node)) setAssignOpen(false);
      if (excludeRef.current && !excludeRef.current.contains(e.target as Node)) setExcludeOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedArray = Array.from(selectedIds);
  const selectedCards = allCards.filter((c) => selectedIds.has(c.id));
  // Bulk exclude from the action bar allows all statuses except already-excluded
  // (the act of selecting and excluding IS the review decision)
  const excludableCards = selectedCards.filter((c) => c.status !== "excluded");
  const excludableIds = excludableCards.map((c) => c.id);
  const skippedCount = selectedIds.size - excludableIds.length;

  if (selectedIds.size === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-background/95 backdrop-blur border shadow-lg rounded-xl px-4 py-3 flex items-center gap-3 animate-in slide-in-from-bottom-2 duration-200">
      {/* Count */}
      <span className="text-sm font-medium whitespace-nowrap">
        {selectedIds.size} selected
      </span>

      <div className="h-5 w-px bg-border" />

      {/* Claim */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          onBulkAssign(selectedArray, currentUserId);
        }}
        disabled={isPending || !currentUserId}
        className="text-xs"
      >
        <Check className="h-3.5 w-3.5 mr-1" />
        Claim
      </Button>

      {/* Assign to */}
      <div className="relative" ref={assignRef}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setAssignOpen(!assignOpen); setExcludeOpen(false); }}
          disabled={isPending}
          className="text-xs"
        >
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Assign to
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
        {assignOpen && (
          <div className="absolute bottom-full mb-1 left-0 z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]">
            <button
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-muted-foreground"
              onClick={() => {
                onBulkAssign(selectedArray, null);
                setAssignOpen(false);
              }}
            >
              Unassign
            </button>
            {assignableMembers.map((m) => (
              <button
                key={m.userId}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                onClick={() => {
                  onBulkAssign(selectedArray, m.userId);
                  setAssignOpen(false);
                }}
              >
                {m.name || m.email}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Exclude */}
      <div className="relative" ref={excludeRef}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setExcludeOpen(!excludeOpen); setAssignOpen(false); }}
          disabled={isPending || excludableIds.length === 0}
          title={excludableIds.length === 0 ? "All selected fields must be reviewed first" : undefined}
          className={cn("text-xs", excludableIds.length > 0 && "hover:text-destructive hover:border-destructive")}
        >
          <Ban className="h-3.5 w-3.5 mr-1" />
          Exclude{excludableIds.length < selectedIds.size && ` (${excludableIds.length}/${selectedIds.size})`}
        </Button>
        {excludeOpen && (
          <div className="absolute bottom-full mb-1 right-0 z-50 bg-popover border rounded-lg shadow-md p-3 w-72 space-y-2">
            {skippedCount > 0 && (
              <p className="text-xs text-amber-600">
                {skippedCount} unreviewed/unmapped field{skippedCount !== 1 ? "s" : ""} will be skipped.
              </p>
            )}
            <textarea
              value={excludeReason}
              onChange={(e) => setExcludeReason(e.target.value)}
              placeholder="Reason (optional)"
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button
              size="sm"
              variant="destructive"
              className="w-full text-xs"
              onClick={() => {
                onBulkExclude(excludableIds, excludeReason.trim() || undefined);
                setExcludeOpen(false);
                setExcludeReason("");
              }}
            >
              Exclude {excludableIds.length} field{excludableIds.length !== 1 ? "s" : ""}
            </Button>
          </div>
        )}
      </div>

      <div className="h-5 w-px bg-border" />

      {/* Clear */}
      <Button
        size="sm"
        variant="ghost"
        onClick={onClearSelection}
        className="text-xs text-muted-foreground"
      >
        <X className="h-3.5 w-3.5 mr-1" />
        Clear
      </Button>
    </div>
  );
}
