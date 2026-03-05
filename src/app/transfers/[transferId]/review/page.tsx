"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { ArrowLeft, ChevronRight } from "lucide-react";

interface TransferMapping {
  id: string;
  targetFieldId: string;
  targetFieldName: string;
  entityName: string;
  parentEntityName: string | null;
  status: string;
  confidence: string | null;
  mappingType: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  reasoning: string | null;
  createdAt: string;
}

interface TransferInfo {
  id: string;
  name: string;
  clientName: string | null;
}

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 };
const STATUS_COLORS: Record<string, string> = {
  unmapped: "bg-gray-100 text-gray-700",
  unreviewed: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  needs_discussion: "bg-purple-100 text-purple-700",
  excluded: "bg-stone-100 text-stone-700",
};
const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-red-100 text-red-700",
};

export default function TransferReviewPage() {
  const { transferId } = useParams<{ transferId: string }>();
  const { workspaceId } = useWorkspace();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: transfer } = useQuery<TransferInfo>({
    queryKey: ["transfer", transferId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/transfers/${transferId}`);
      if (!res.ok) throw new Error("Failed to load transfer");
      return res.json();
    },
    enabled: !!workspaceId && !!transferId,
  });

  const { data: mappings, isLoading } = useQuery<TransferMapping[]>({
    queryKey: ["transfer-review-queue", transferId, workspaceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/review-queue?transferId=${transferId}`
      );
      if (!res.ok) throw new Error("Failed to load review queue");
      return res.json();
    },
    enabled: !!workspaceId && !!transferId,
  });

  // Compute domains from entity names
  const domains = useMemo(() => {
    if (!mappings) return [];
    const set = new Set(mappings.map((m) => m.parentEntityName || m.entityName));
    return Array.from(set).sort();
  }, [mappings]);

  // Compute status counts
  const statusCounts = useMemo(() => {
    if (!mappings) return {};
    const counts: Record<string, number> = {};
    for (const m of mappings) {
      counts[m.status] = (counts[m.status] || 0) + 1;
    }
    return counts;
  }, [mappings]);

  // Filter and sort
  const filtered = useMemo(() => {
    if (!mappings) return [];
    return mappings
      .filter((m) => {
        if (statusFilter !== "all" && m.status !== statusFilter) return false;
        if (confidenceFilter !== "all" && m.confidence !== confidenceFilter) return false;
        if (domainFilter !== "all") {
          const domain = m.parentEntityName || m.entityName;
          if (domain !== domainFilter) return false;
        }
        if (search) {
          const q = search.toLowerCase();
          return (
            m.targetFieldName.toLowerCase().includes(q) ||
            m.entityName.toLowerCase().includes(q) ||
            (m.sourceFieldName || "").toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        // Sort: unreviewed first, then by confidence (low first)
        const statusOrder = { unreviewed: 0, needs_discussion: 1, unmapped: 2, accepted: 3, excluded: 4 };
        const sa = statusOrder[a.status as keyof typeof statusOrder] ?? 2;
        const sb = statusOrder[b.status as keyof typeof statusOrder] ?? 2;
        if (sa !== sb) return sa - sb;
        const ca = CONFIDENCE_ORDER[a.confidence as keyof typeof CONFIDENCE_ORDER] ?? 1;
        const cb = CONFIDENCE_ORDER[b.confidence as keyof typeof CONFIDENCE_ORDER] ?? 1;
        return ca - cb;
      });
  }, [mappings, statusFilter, confidenceFilter, domainFilter, search]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <Link
          href={`/transfers/${transferId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {transfer?.name || "Transfer"}
        </Link>
        <h1 className="text-xl font-semibold">Review Queue</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {transfer?.clientName ? `${transfer.clientName} — ` : ""}
          {mappings?.length ?? 0} mappings
        </p>
      </div>

      {/* Status summary */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(statusCounts).sort().map(([status, count]) => (
          <button
            key={status}
            onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === status
                ? "ring-2 ring-primary ring-offset-1"
                : ""
            } ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}
          >
            {status} <span className="opacity-70">{count}</span>
          </button>
        ))}
        {statusFilter !== "all" && (
          <button
            onClick={() => setStatusFilter("all")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Filters row */}
      <div className="flex gap-3 items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fields..."
          className="rounded-lg border px-3 py-1.5 text-sm bg-background w-64"
        />
        <select
          value={confidenceFilter}
          onChange={(e) => setConfidenceFilter(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-background"
        >
          <option value="all">All confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-background"
        >
          <option value="all">All entities</option>
          {domains.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {mappings?.length ?? 0}
        </span>
      </div>

      {/* Mapping list */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className="px-4 py-2.5 font-medium">Entity / Field</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Confidence</th>
                <th className="px-4 py-2.5 font-medium w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b last:border-0 hover:bg-muted/50 group">
                  <td className="px-4 py-2.5">
                    <div className="text-xs text-muted-foreground">{m.entityName}</div>
                    <div className="font-medium">{m.targetFieldName}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {m.sourceFieldName ? (
                      <span className="font-mono text-xs">{m.sourceFieldName}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[m.status] || ""}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {m.confidence ? (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[m.confidence] || ""}`}>
                        {m.confidence}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/mapping/discuss/${m.id}`}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No mappings match filters
            </div>
          )}
        </div>
      )}
    </div>
  );
}
