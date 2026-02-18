"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useExcludeMapping, useBatchExclude, useReviewQueue } from "@/queries/review-queries";
import type { ReviewCardData } from "@/types/review";

interface ExcludeDialogProps {
  card: ReviewCardData;
  onClose: () => void;
}

interface SimilarField {
  id: string;
  targetFieldName: string;
  entityName: string;
  reason: "same_entity" | "name_pattern";
  patternLabel?: string;
}

function detectSimilarFields(
  card: ReviewCardData,
  allCards: ReviewCardData[]
): SimilarField[] {
  const results: SimilarField[] = [];
  const seen = new Set<string>([card.id]);

  // Only suggest unreviewed or unmapped fields
  const candidates = allCards.filter(
    (c) =>
      !seen.has(c.id) &&
      (c.status === "unreviewed" || c.status === "unmapped")
  );

  // 1. Same entity — other unreviewed/unmapped fields
  for (const c of candidates) {
    if (c.entityId === card.entityId && !seen.has(c.id)) {
      results.push({
        id: c.id,
        targetFieldName: c.targetFieldName,
        entityName: c.entityName,
        reason: "same_entity",
      });
      seen.add(c.id);
    }
  }

  // 2. Name pattern — suffix/prefix matching across entities
  const name = card.targetFieldName;
  const parts = name.split("_");

  if (parts.length >= 2) {
    // Try suffix (last 1-2 segments) and prefix (first 1-2 segments)
    const patterns: { pattern: string; label: string }[] = [];

    // Suffix patterns: *_lastPart, *_secondLast_lastPart
    const suffix1 = `_${parts[parts.length - 1]}`;
    if (suffix1.length > 2) {
      patterns.push({ pattern: suffix1, label: `*${suffix1}` });
    }
    if (parts.length >= 3) {
      const suffix2 = `_${parts[parts.length - 2]}_${parts[parts.length - 1]}`;
      patterns.push({ pattern: suffix2, label: `*${suffix2}` });
    }

    // Prefix patterns: firstPart_*, firstPart_secondPart_*
    const prefix1 = `${parts[0]}_`;
    if (prefix1.length > 2) {
      patterns.push({ pattern: prefix1, label: `${prefix1}*` });
    }
    if (parts.length >= 3) {
      const prefix2 = `${parts[0]}_${parts[1]}_`;
      patterns.push({ pattern: prefix2, label: `${prefix2}*` });
    }

    for (const { pattern, label } of patterns) {
      for (const c of candidates) {
        if (seen.has(c.id)) continue;
        const cName = c.targetFieldName;
        if (
          (pattern.startsWith("_") && cName.endsWith(pattern)) ||
          (pattern.endsWith("_") && cName.startsWith(pattern))
        ) {
          results.push({
            id: c.id,
            targetFieldName: c.targetFieldName,
            entityName: c.entityName,
            reason: "name_pattern",
            patternLabel: label,
          });
          seen.add(c.id);
        }
      }
    }
  }

  return results;
}

export function ExcludeDialog({ card, onClose }: ExcludeDialogProps) {
  const [reason, setReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const excludeMutation = useExcludeMapping();
  const batchMutation = useBatchExclude();

  // Use the cached review queue data (no new API call)
  const { data: allCards } = useReviewQueue();

  const similarFields = useMemo(
    () => detectSimilarFields(card, allCards ?? []),
    [card, allCards]
  );

  const sameEntityFields = similarFields.filter((f) => f.reason === "same_entity");
  const patternFields = similarFields.filter((f) => f.reason === "name_pattern");

  // Group pattern fields by their pattern label
  const patternGroups = useMemo(() => {
    const groups = new Map<string, SimilarField[]>();
    for (const f of patternFields) {
      const label = f.patternLabel || "pattern";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(f);
    }
    return groups;
  }, [patternFields]);

  const hasSuggestions = similarFields.length > 0;
  const totalToExclude = 1 + selectedIds.size;
  const isPending = excludeMutation.isPending || batchMutation.isPending;

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === similarFields.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(similarFields.map((f) => f.id)));
    }
  };

  const toggleGroup = (ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allInGroup = ids.every((id) => next.has(id));
      if (allInGroup) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleExclude = async () => {
    try {
      if (selectedIds.size === 0) {
        // Single exclude
        await excludeMutation.mutateAsync({
          mappingId: card.id,
          reason: reason.trim() || undefined,
        });
      } else {
        // Batch exclude (includes the primary card)
        await batchMutation.mutateAsync({
          mappingIds: [card.id, ...Array.from(selectedIds)],
          reason: reason.trim() || undefined,
        });
      }
      onClose();
    } catch {
      // Error handled by mutation
    }
  };

  const allSelected = similarFields.length > 0 && selectedIds.size === similarFields.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-lg w-full max-w-md p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">Exclude Mapping</h3>
        <p className="text-sm text-muted-foreground">
          Exclude <strong>{card.targetFieldName}</strong> ({card.entityName})
          from the mapping scope.
        </p>

        <div className="space-y-2">
          <label className="text-sm font-medium">Reason (optional)</label>
          <textarea
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[60px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Why is this field being excluded?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {hasSuggestions && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Similar fields</label>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>

            {sameEntityFields.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Same entity ({card.entityName})
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleGroup(sameEntityFields.map((f) => f.id))}
                    className="text-[10px] text-primary hover:underline"
                  >
                    {sameEntityFields.every((f) => selectedIds.has(f.id))
                      ? "Deselect group"
                      : "Select group"}
                  </button>
                </div>
                {sameEntityFields.map((f) => (
                  <label
                    key={f.id}
                    className="flex items-center gap-2 text-sm py-0.5 cursor-pointer hover:bg-muted/30 rounded px-1"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(f.id)}
                      onChange={() => toggleId(f.id)}
                      className="accent-primary"
                    />
                    <code className="text-xs">{f.targetFieldName}</code>
                  </label>
                ))}
              </div>
            )}

            {patternGroups.size > 0 &&
              Array.from(patternGroups.entries()).map(([label, fields]) => (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Pattern: <code className="text-[10px]">{label}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(fields.map((f) => f.id))}
                      className="text-[10px] text-primary hover:underline"
                    >
                      {fields.every((f) => selectedIds.has(f.id))
                        ? "Deselect group"
                        : "Select group"}
                    </button>
                  </div>
                  {fields.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 text-sm py-0.5 cursor-pointer hover:bg-muted/30 rounded px-1"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(f.id)}
                        onChange={() => toggleId(f.id)}
                        className="accent-primary"
                      />
                      <code className="text-xs">{f.targetFieldName}</code>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {f.entityName}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleExclude}
            disabled={isPending}
          >
            {isPending
              ? "Excluding..."
              : totalToExclude > 1
                ? `Exclude ${totalToExclude} fields`
                : "Exclude"}
          </Button>
        </div>

        {(excludeMutation.isError || batchMutation.isError) && (
          <p className="text-sm text-destructive">
            {excludeMutation.error?.message || batchMutation.error?.message}
          </p>
        )}
      </div>
    </div>
  );
}
