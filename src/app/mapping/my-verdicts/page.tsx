"use client";

import { useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMyVerdicts } from "@/queries/review-queries";
import { Badge } from "@/components/ui/badge";
import { MAPPING_STATUS_LABELS, MAPPING_STATUS_COLORS, MAPPING_TYPE_LABELS } from "@/lib/constants";
import type { MappingStatus, MappingType } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ArrowLeft, ExternalLink } from "lucide-react";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function MyVerdictsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: verdicts, isLoading } = useMyVerdicts();

  const workflowFilter = searchParams.get("workflow") || "all";
  const transferIdFilter = searchParams.get("transferId") || null;
  const statusFilter = searchParams.get("status") || "all";
  const searchQuery = searchParams.get("q") || "";

  const setFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all" || value === "") params.delete(key);
      else params.set(key, value);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  // Derive workflow options from data
  const workflowOptions = useMemo(() => {
    if (!verdicts) return [];
    const transfers = new Map<string, string>();
    for (const v of verdicts) {
      if (v.transferId && v.transferName) {
        transfers.set(v.transferId, v.transferName);
      }
    }
    return Array.from(transfers.entries()).map(([id, name]) => ({ id, name }));
  }, [verdicts]);

  // Filter
  const filtered = useMemo(() => {
    if (!verdicts) return [];
    return verdicts.filter((v) => {
      // Workflow / transfer filter
      if (transferIdFilter && v.transferId !== transferIdFilter) return false;
      if (workflowFilter === "sdt" && v.transferId) return false;
      if (workflowFilter !== "all" && workflowFilter !== "sdt" && v.transferId !== workflowFilter) return false;
      // Status filter
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      // Text search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !v.targetFieldName.toLowerCase().includes(q) &&
          !v.entityName.toLowerCase().includes(q) &&
          !(v.sourceFieldName || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [verdicts, workflowFilter, transferIdFilter, statusFilter, searchQuery]);

  // Status counts for pills
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of filtered) {
      counts[v.status] = (counts[v.status] || 0) + 1;
    }
    return counts;
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold mb-4">My Verdicts</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-xl font-bold">My Verdicts</h1>
          <span className="text-sm text-muted-foreground">
            {filtered.length} reviewed field{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={searchQuery}
          onChange={(e) => setFilter("q", e.target.value)}
          placeholder="Search fields..."
          className="rounded-lg border px-3 py-1.5 text-sm bg-background w-56 border-border focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={transferIdFilter || workflowFilter}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "all" || val === "sdt") {
              setFilter("workflow", val);
              setFilter("transferId", "");
            } else {
              setFilter("workflow", "all");
              setFilter("transferId", val);
            }
          }}
          className="rounded-lg border px-3 py-1.5 text-sm bg-background border-border focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All Workflows</option>
          <option value="sdt">SDT Mapping</option>
          {workflowOptions.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setFilter("status", e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-background border-border focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All Statuses</option>
          <option value="accepted">Accepted</option>
          <option value="needs_discussion">Needs Discussion</option>
          <option value="punted">Punted</option>
          <option value="excluded">Excluded</option>
        </select>
      </div>

      {/* Status summary pills */}
      <div className="flex items-center gap-2">
        {Object.entries(statusCounts).map(([status, count]) => (
          <button
            key={status}
            onClick={() => setFilter("status", statusFilter === status ? "all" : status)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
              statusFilter === status
                ? "bg-foreground text-background border-foreground"
                : "border-border hover:border-foreground/30"
            )}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: MAPPING_STATUS_COLORS[status as MappingStatus] }}
            />
            {MAPPING_STATUS_LABELS[status as MappingStatus] || status} ({count})
          </button>
        ))}
      </div>

      {/* Results table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {verdicts?.length === 0
            ? "You haven't reviewed any fields yet."
            : "No verdicts match the current filters."}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Transform</th>
                <th className="px-3 py-2 font-medium">Workflow</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr
                  key={v.id}
                  className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => router.push(`/mapping/discuss/${v.id}`)}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      <code className="text-xs">{v.entityName}.{v.targetFieldName}</code>
                    </div>
                    {v.targetFieldDataType && (
                      <span className="text-[10px] text-muted-foreground font-mono">{v.targetFieldDataType}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5"
                      style={{
                        borderColor: MAPPING_STATUS_COLORS[v.status],
                        color: MAPPING_STATUS_COLORS[v.status],
                      }}
                    >
                      {MAPPING_STATUS_LABELS[v.status] || v.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {v.sourceVerdict ? (
                      <span className={cn(
                        "text-xs",
                        v.sourceVerdict === "correct" ? "text-green-600" : "text-amber-600"
                      )}>
                        {v.sourceVerdict}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {v.transformVerdict ? (
                      <span className={cn(
                        "text-xs",
                        v.transformVerdict === "correct" ? "text-green-600" : "text-amber-600"
                      )}>
                        {v.transformVerdict}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "text-xs px-1.5 py-0.5 rounded",
                      v.transferName
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    )}>
                      {v.transferName || "SDT"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {relativeTime(v.updatedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
