"use client";

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEntities } from "@/queries/entity-queries";
import { useStartBatchRun } from "@/queries/batch-run-queries";
import { useReviewStore } from "@/stores/review-store";
import { Component, Loader2 } from "lucide-react";
import {
  MAPPING_STATUSES,
  MAPPING_STATUS_LABELS,
  MAPPING_STATUS_COLORS,
  type MappingStatus,
} from "@/lib/constants";
import type { Entity } from "@/types/entity";

const DEFAULT_INCLUDE: MappingStatus[] = [...MAPPING_STATUSES];

type EntityWithCounts = Entity & { fieldCount: number; statusBreakdown: Record<string, number> };

interface ParentGroup {
  entity: EntityWithCounts;
  children: EntityWithCounts[];
  /** Aggregated across parent + children */
  totalFieldCount: number;
}

interface BatchRunDialogProps {
  onClose: () => void;
}

export function BatchRunDialog({ onClose }: BatchRunDialogProps) {
  const { data: entities } = useEntities({ side: "target" });
  const startMutation = useStartBatchRun();
  const { setActiveBatchRunId } = useReviewStore();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeStatuses, setIncludeStatuses] = useState<Set<MappingStatus>>(
    new Set(DEFAULT_INCLUDE)
  );

  // Group entities: top-level parents with children folded in
  const parentGroups = useMemo<ParentGroup[]>(() => {
    if (!entities) return [];

    const childMap = new Map<string, EntityWithCounts[]>();
    const childIds = new Set<string>();

    for (const e of entities) {
      if (e.parentEntityId) {
        childIds.add(e.id);
        const siblings = childMap.get(e.parentEntityId) || [];
        siblings.push(e);
        childMap.set(e.parentEntityId, siblings);
      }
    }

    const groups: ParentGroup[] = [];
    for (const e of entities) {
      if (childIds.has(e.id)) continue;
      const children = (childMap.get(e.id) || []).sort((a, b) =>
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
      );
      groups.push({
        entity: e,
        children,
        totalFieldCount: e.fieldCount + children.reduce((s, c) => s + c.fieldCount, 0),
      });
    }

    groups.sort((a, b) =>
      (a.entity.displayName || a.entity.name).localeCompare(
        b.entity.displayName || b.entity.name
      )
    );

    return groups;
  }, [entities]);

  const allSelected =
    parentGroups.length > 0 && selectedIds.size === parentGroups.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(parentGroups.map((g) => g.entity.id)));
    }
  };

  const toggleEntity = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleStatus = (status: MappingStatus) => {
    setIncludeStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  /** Compute eligible field count for an entity given current status selection */
  const getEligibleCount = useCallback((e: {
    fieldCount: number;
    statusBreakdown?: Record<string, number>;
  }) => {
    const breakdown = e.statusBreakdown ?? {};
    let count = 0;
    const mappedTotal = Object.values(breakdown).reduce((s, n) => s + n, 0);
    if (includeStatuses.has("unmapped")) {
      count += e.fieldCount - mappedTotal;
    }
    for (const status of MAPPING_STATUSES) {
      if (status === "unmapped") continue;
      if (includeStatuses.has(status)) {
        count += breakdown[status] ?? 0;
      }
    }
    return count;
  }, [includeStatuses]);

  /** Eligible count aggregated across parent + children */
  const getGroupEligibleCount = useCallback((group: ParentGroup) => {
    let count = getEligibleCount(group.entity);
    for (const child of group.children) {
      count += getEligibleCount(child);
    }
    return count;
  }, [getEligibleCount]);

  const { eligibleFields, totalFields } = useMemo(() => {
    let eligible = 0;
    let total = 0;
    for (const g of parentGroups) {
      if (selectedIds.has(g.entity.id)) {
        eligible += getGroupEligibleCount(g);
        total += g.totalFieldCount;
      }
    }
    return { eligibleFields: eligible, totalFields: total };
  }, [parentGroups, selectedIds, getGroupEligibleCount]);

  const handleStart = async () => {
    try {
      const config: {
        mode: "single-shot";
        entityIds?: string[];
        includeStatuses: string[];
        outputFormat: "yaml";
      } = {
        mode: "single-shot",
        outputFormat: "yaml",
        includeStatuses: Array.from(includeStatuses),
      };

      // Only pass entityIds if not all are selected (send only parent IDs)
      if (selectedIds.size > 0 && selectedIds.size < parentGroups.length) {
        config.entityIds = Array.from(selectedIds);
      }

      const result = await startMutation.mutateAsync(config);
      setActiveBatchRunId(result.batchRunId);
      onClose();
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-lg w-full max-w-lg p-6 space-y-4 max-h-[80vh] flex flex-col">
        <h3 className="text-lg font-semibold">Start Batch Run</h3>

        {/* Status inclusion checkboxes */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Include fields with status</label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {MAPPING_STATUSES.map((status) => (
              <label
                key={status}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={includeStatuses.has(status)}
                  onChange={() => toggleStatus(status)}
                  className="accent-primary h-3.5 w-3.5 rounded"
                />
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: MAPPING_STATUS_COLORS[status] }}
                />
                <span className="text-sm">{MAPPING_STATUS_LABELS[status]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Entity selection */}
        <div className="space-y-2 flex-1 min-h-0">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Entities</label>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-primary hover:underline"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>

          <div className="border rounded-lg overflow-y-auto max-h-[40vh]">
            {!entities ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Loading entities...
              </div>
            ) : parentGroups.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No target entities found.
              </div>
            ) : (
              parentGroups.map((group) => {
                const eligible = getGroupEligibleCount(group);
                const total = group.totalFieldCount;
                const checked = selectedIds.has(group.entity.id);

                return (
                  <div key={group.entity.id} className="border-b last:border-b-0">
                    <label
                      className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer ${
                        checked ? "bg-muted/30" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEntity(group.entity.id)}
                        className="accent-primary h-4 w-4 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block">
                          {group.entity.displayName || group.entity.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {eligible}/{total} eligible
                        </span>
                        {eligible > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {eligible}
                          </Badge>
                        )}
                      </div>
                    </label>
                    {/* Show children as info-only sub-items */}
                    {group.children.length > 0 && (
                      <div className="pl-10 pb-1.5">
                        {group.children.map((child) => (
                          <div
                            key={child.id}
                            className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground"
                          >
                            <Component className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {child.displayName || child.name}
                            </span>
                            <span className="ml-auto shrink-0">
                              {child.fieldCount} fields
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Summary + actions */}
        <div className="space-y-3 pt-2">
          <div className="text-sm text-muted-foreground">
            {selectedIds.size > 0 ? (
              <>
                {selectedIds.size}{" "}
                {selectedIds.size === 1 ? "entity" : "entities"} selected
                {" · "}
                {eligibleFields}{" "}
                {eligibleFields === 1 ? "field" : "fields"} to process
                {eligibleFields < totalFields && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    (of {totalFields} total)
                  </span>
                )}
              </>
            ) : (
              "Select entities to map"
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleStart}
              disabled={
                selectedIds.size === 0 ||
                includeStatuses.size === 0 ||
                startMutation.isPending
              }
            >
              {startMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Starting...
                </>
              ) : (
                `Start (${selectedIds.size} ${selectedIds.size === 1 ? "entity" : "entities"})`
              )}
            </Button>
          </div>

          {startMutation.isError && (
            <p className="text-sm text-destructive">
              {startMutation.error.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
