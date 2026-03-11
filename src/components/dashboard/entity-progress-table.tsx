"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Component } from "lucide-react";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  type MappingStatus,
} from "@/lib/constants";
import type { EntityWithStats } from "@/types/entity";

const STATUS_ORDER: MappingStatus[] = [
  "accepted",
  "excluded",
  "unreviewed",
  "punted",
  "needs_discussion",
  "unmapped",
];

/** Weighted progress score for sorting */
const STATUS_WEIGHTS: Record<string, number> = {
  accepted: 3,
  excluded: 2,
  unreviewed: 1,
  punted: 1,
  needs_discussion: 1,
  unmapped: 0,
};

interface EntityGroupRow {
  entity: EntityWithStats;
  children: EntityWithStats[];
  /** Aggregated across parent + children */
  totalFieldCount: number;
  totalMappedCount: number;
  totalCoveragePercent: number;
  totalOpenQuestions: number;
  totalStatusBreakdown: Record<string, number>;
}

function progressScore(breakdown: Record<string, number>, fieldCount: number): number {
  if (!breakdown || fieldCount === 0) return 0;
  let score = 0;
  for (const [status, count] of Object.entries(breakdown)) {
    score += (STATUS_WEIGHTS[status] ?? 0) * count;
  }
  return (score / (3 * fieldCount)) * 100;
}

function mergeBreakdowns(...breakdowns: Record<string, number>[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const bd of breakdowns) {
    for (const [k, v] of Object.entries(bd)) {
      merged[k] = (merged[k] || 0) + v;
    }
  }
  return merged;
}

export function EntityProgressTable({
  entities,
}: {
  entities: EntityWithStats[];
}) {
  const groups = useMemo(() => {
    if (entities.length === 0) return [];

    // Bucket entities: parents vs children
    const childMap = new Map<string, EntityWithStats[]>(); // parentId → children
    const parentMap = new Map<string, EntityWithStats>();
    const childIds = new Set<string>();

    for (const e of entities) {
      if (e.parentEntityId) {
        childIds.add(e.id);
        const siblings = childMap.get(e.parentEntityId) || [];
        siblings.push(e);
        childMap.set(e.parentEntityId, siblings);
      }
    }

    // Build groups: top-level entities only
    const rows: EntityGroupRow[] = [];
    for (const e of entities) {
      if (childIds.has(e.id)) continue; // skip children

      const children = (childMap.get(e.id) || []).sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      const allBreakdowns = [
        e.statusBreakdown || {},
        ...children.map((c) => c.statusBreakdown || {}),
      ];
      const totalStatusBreakdown = mergeBreakdowns(...allBreakdowns);
      const totalFieldCount = e.fieldCount + children.reduce((s, c) => s + c.fieldCount, 0);
      const totalMappedCount = e.mappedCount + children.reduce((s, c) => s + c.mappedCount, 0);
      const totalOpenQuestions = e.openQuestions + children.reduce((s, c) => s + c.openQuestions, 0);

      rows.push({
        entity: e,
        children,
        totalFieldCount,
        totalMappedCount,
        totalCoveragePercent: totalFieldCount > 0 ? Math.round((totalMappedCount / totalFieldCount) * 100) : 0,
        totalOpenQuestions,
        totalStatusBreakdown,
      });
    }

    rows.sort((a, b) =>
      progressScore(b.totalStatusBreakdown, b.totalFieldCount) -
      progressScore(a.totalStatusBreakdown, a.totalFieldCount)
    );

    return rows;
  }, [entities]);

  if (entities.length === 0) return null;

  const parentCount = groups.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Entity Progress
        </h2>
        <span className="text-xs text-muted-foreground">
          {parentCount} entities
        </span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left font-medium text-muted-foreground px-3 py-2">
                Entity
              </th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2 w-20">
                Fields
              </th>
              <th className="font-medium text-muted-foreground px-3 py-2 w-48 hidden md:table-cell">
                Status
              </th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2 w-20">
                Coverage
              </th>
              <th className="text-right font-medium text-muted-foreground px-3 py-2 w-16">
                Qs
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <EntityGroupRows
                key={g.entity.id}
                group={g}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            className="flex items-center gap-1.5 text-[11px]"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: MAPPING_STATUS_COLORS[status] || "#6b7280",
              }}
            />
            <span className="text-muted-foreground">
              {MAPPING_STATUS_LABELS[status] || status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBar({ breakdown, fieldCount }: { breakdown: Record<string, number>; fieldCount: number }) {
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
      {STATUS_ORDER.map((status) => {
        const count = breakdown[status] || 0;
        if (count === 0 || fieldCount === 0) return null;
        const pct = (count / fieldCount) * 100;
        return (
          <div
            key={status}
            className="h-full"
            style={{
              width: `${pct}%`,
              backgroundColor: MAPPING_STATUS_COLORS[status] || "#6b7280",
            }}
            title={`${MAPPING_STATUS_LABELS[status] || status}: ${count}`}
          />
        );
      })}
    </div>
  );
}

function EntityGroupRows({ group }: { group: EntityGroupRow }) {
  const { entity: e, children, totalFieldCount, totalCoveragePercent, totalOpenQuestions, totalStatusBreakdown } = group;
  const hasChildren = children.length > 0;

  return (
    <>
      {/* Parent row — show aggregated stats when it has children */}
      <tr className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
        <td className="px-3 py-2">
          <Link
            href={`/mapping?entityId=${e.id}`}
            className="hover:underline underline-offset-2"
          >
            {e.name}
          </Link>
        </td>
        <td className="text-right px-3 py-2 tabular-nums text-muted-foreground">
          {hasChildren ? totalFieldCount : e.fieldCount}
        </td>
        <td className="px-3 py-2 hidden md:table-cell">
          <StatusBar
            breakdown={hasChildren ? totalStatusBreakdown : (e.statusBreakdown || {})}
            fieldCount={hasChildren ? totalFieldCount : e.fieldCount}
          />
        </td>
        <td className="text-right px-3 py-2 tabular-nums font-medium">
          {hasChildren ? totalCoveragePercent : e.coveragePercent}%
        </td>
        <td className="text-right px-3 py-2 tabular-nums">
          {(hasChildren ? totalOpenQuestions : e.openQuestions) > 0 ? (
            <span className="text-amber-500">
              {hasChildren ? totalOpenQuestions : e.openQuestions}
            </span>
          ) : (
            <span className="text-muted-foreground/40">&mdash;</span>
          )}
        </td>
      </tr>

      {/* Child rows — indented */}
      {children.map((child) => (
        <tr
          key={child.id}
          className="border-b last:border-b-0 hover:bg-muted/20 transition-colors bg-muted/10"
        >
          <td className="px-3 py-1.5 pl-7">
            <Link
              href={`/mapping?entityId=${child.id}`}
              className="hover:underline underline-offset-2 text-muted-foreground text-xs inline-flex items-center gap-1.5"
            >
              <Component className="h-3 w-3 shrink-0" />
              {child.name}
            </Link>
          </td>
          <td className="text-right px-3 py-1.5 tabular-nums text-muted-foreground text-xs">
            {child.fieldCount}
          </td>
          <td className="px-3 py-1.5 hidden md:table-cell">
            <StatusBar
              breakdown={child.statusBreakdown || {}}
              fieldCount={child.fieldCount}
            />
          </td>
          <td className="text-right px-3 py-1.5 tabular-nums text-xs">
            {child.coveragePercent}%
          </td>
          <td className="text-right px-3 py-1.5 tabular-nums text-xs">
            {child.openQuestions > 0 ? (
              <span className="text-amber-500">{child.openQuestions}</span>
            ) : (
              <span className="text-muted-foreground/40">&mdash;</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
