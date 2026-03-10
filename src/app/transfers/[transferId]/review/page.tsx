"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { useToast } from "@/components/ui/toast";
import { api, workspacePath } from "@/lib/api-client";
import { ArrowLeft, Users, EyeOff, Eye, XCircle } from "lucide-react";
import { DistributeDialog } from "@/components/review/distribute-dialog";
import { EntityGroup } from "@/components/review/entity-group";
import { useReassignMapping } from "@/queries/review-queries";
import type { ReviewCardData, ChildEntityGroup } from "@/types/review";
import type { MappingStatus } from "@/lib/constants";

interface TransferInfo {
  id: string;
  name: string;
  clientName: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  unmapped: "bg-gray-100 text-gray-700",
  unreviewed: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  needs_discussion: "bg-purple-100 text-purple-700",
  punted: "bg-amber-100 text-amber-700",
  excluded: "bg-stone-100 text-stone-700",
};

export default function TransferReviewPage() {
  const { transferId } = useParams<{ transferId: string }>();
  const { workspaceId } = useWorkspace();
  const { data: session } = useSession();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const router = useRouter();
  const searchParams = useSearchParams();

  // Persist filters in URL params
  const statusFilter = searchParams.get("status") || "all";
  const confidenceFilter = searchParams.get("confidence") || "all";
  const domainFilter = searchParams.get("entity") || "all";
  const assigneeFilter = searchParams.get("assignee") || "all";
  const search = searchParams.get("q") || "";
  const showExcluded = searchParams.get("excluded") === "1";
  const hideSystemFields = searchParams.get("hideSystem") !== "0"; // default ON
  const [distributeOpen, setDistributeOpen] = useState(false);

  const setFilter = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all" || value === "" || value === "0") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const setStatusFilter = (v: string) => setFilter("status", v);
  const setConfidenceFilter = (v: string) => setFilter("confidence", v);
  const setDomainFilter = (v: string) => setFilter("entity", v);
  const setAssigneeFilter = (v: string) => setFilter("assignee", v);
  const setSearch = (v: string) => setFilter("q", v);
  const setShowExcluded = (v: boolean) => setFilter("excluded", v ? "1" : "0");
  const setHideSystemFields = (v: boolean) => setFilter("hideSystem", v ? "1" : "0");

  const claimMutation = useReassignMapping();
  const batchAssignMutation = useMutation({
    mutationFn: ({ mappingIds, assigneeId }: { mappingIds: string[]; assigneeId: string | null }) =>
      api.post(workspacePath(workspaceId, "mappings/batch-assign"), { mappingIds, assigneeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    },
  });

  const currentUserId = (session?.user as { id?: string })?.id ?? null;

  const { data: transfer } = useQuery<TransferInfo>({
    queryKey: ["transfer", transferId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/transfers/${transferId}`);
      if (!res.ok) throw new Error("Failed to load transfer");
      return res.json();
    },
    enabled: !!workspaceId && !!transferId,
  });

  // Fetch cards from the shared review-queue API (already returns ReviewCardData shape)
  const { data: cards, isLoading } = useQuery<ReviewCardData[]>({
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

  // Determine which entities are transfer-excluded
  const excludedEntityIds = useMemo(() => {
    if (!cards) return new Set<string>();
    const ids = new Set<string>();
    for (const c of cards) {
      if ((c.entityMetadata as Record<string, unknown>)?.transferExcluded === true) {
        ids.add(c.entityId);
      }
    }
    return ids;
  }, [cards]);

  const excludedCount = useMemo(() => excludedEntityIds.size, [excludedEntityIds]);

  // Compute entity/domain list
  const domains = useMemo(() => {
    if (!cards) return [];
    const set = new Set(cards.map((c) => c.parentEntityName || c.entityName));
    return Array.from(set).sort();
  }, [cards]);

  // Filter
  const filtered = useMemo(() => {
    if (!cards) return [];
    return cards.filter((c) => {
      if (!showExcluded && excludedEntityIds.has(c.entityId)) return false;
      if (hideSystemFields && /(_id|_sid)$/.test(c.targetFieldName) && c.status === "unmapped") return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (confidenceFilter !== "all" && c.confidence !== confidenceFilter) return false;
      if (assigneeFilter === "mine" && c.assigneeId !== currentUserId) return false;
      if (assigneeFilter === "unclaimed" && c.assigneeId) return false;
      if (domainFilter !== "all") {
        const domain = c.parentEntityName || c.entityName;
        if (domain !== domainFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          c.targetFieldName.toLowerCase().includes(q) ||
          c.entityName.toLowerCase().includes(q) ||
          (c.sourceFieldName || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [cards, statusFilter, confidenceFilter, domainFilter, assigneeFilter, currentUserId, search, showExcluded, excludedEntityIds]);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of filtered) {
      counts[c.status] = (counts[c.status] || 0) + 1;
    }
    return counts;
  }, [filtered]);

  // Persist filtered queue order for discuss page navigation
  useEffect(() => {
    if (filtered.length > 0) {
      sessionStorage.setItem("reviewQueueOrder", JSON.stringify(filtered.map((c) => c.id)));
    }
  }, [filtered]);

  // Group by parent entity (same pattern as SDT ReviewQueueList)
  const entityGroups = useMemo(() => {
    const parentMap = new Map<string, { entityId: string; entityName: string; cards: ReviewCardData[]; childMap: Map<string, ChildEntityGroup> }>();

    for (const card of filtered) {
      const parentId = card.parentEntityId || card.entityId;
      const parentName = card.parentEntityName || card.entityName;

      if (!parentMap.has(parentId)) {
        parentMap.set(parentId, { entityId: parentId, entityName: parentName, cards: [], childMap: new Map() });
      }
      const group = parentMap.get(parentId)!;

      if (card.parentEntityId && card.entityId !== card.parentEntityId) {
        // Child entity
        if (!group.childMap.has(card.entityId)) {
          group.childMap.set(card.entityId, { entityId: card.entityId, entityName: card.entityName, cards: [] });
        }
        group.childMap.get(card.entityId)!.cards.push(card);
      } else {
        group.cards.push(card);
      }
    }

    return Array.from(parentMap.values()).map((g) => ({
      entityId: g.entityId,
      entityName: g.entityName,
      cards: g.cards,
      childGroups: Array.from(g.childMap.values()),
      totalCardCount: g.cards.length + Array.from(g.childMap.values()).reduce((sum, c) => sum + c.cards.length, 0),
    }));
  }, [filtered]);

  const toggleEntityExclusion = useCallback(
    async (entityId: string, entityName: string, exclude: boolean) => {
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/entities/${entityId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              metadata: {
                transferExcluded: exclude,
                transferExcludeReason: exclude ? "Excluded from transfer review" : null,
              },
            }),
          }
        );
        if (!res.ok) throw new Error("Failed to update entity");
        queryClient.invalidateQueries({ queryKey: ["transfer-review-queue"] });
        addToast({
          type: "success",
          title: exclude ? `${entityName} excluded` : `${entityName} restored`,
          action: { label: "Undo", onClick: () => toggleEntityExclusion(entityId, entityName, !exclude) },
        });
      } catch {
        addToast({ type: "error", title: "Failed to update entity" });
      }
    },
    [workspaceId, queryClient, addToast]
  );

  const visibleTotal = filtered.length;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
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
            {visibleTotal} mappings
            {excludedCount > 0 && !showExcluded && (
              <span className="text-xs ml-1">
                ({excludedCount} {excludedCount === 1 ? "entity" : "entities"} excluded)
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setDistributeOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
        >
          <Users className="h-3.5 w-3.5" />
          Distribute Fields
        </button>
      </div>

      {/* Status summary */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(statusCounts).sort().map(([status, count]) => (
          <button
            key={status}
            onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === status ? "ring-2 ring-primary ring-offset-1" : ""
            } ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}
          >
            {status} <span className="opacity-70">{count}</span>
          </button>
        ))}
        {statusFilter !== "all" && (
          <button onClick={() => setStatusFilter("all")} className="text-xs text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
      </div>

      {/* Filters row */}
      <div className="flex gap-3 items-center flex-wrap">
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
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-background"
        >
          <option value="all">All assignees</option>
          <option value="mine">My fields</option>
          <option value="unclaimed">Unclaimed</option>
        </select>

        <button
          onClick={() => setHideSystemFields(!hideSystemFields)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            hideSystemFields
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : "bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          {hideSystemFields ? "System fields hidden" : "Show system fields"}
        </button>

        {excludedCount > 0 && (
          <button
            onClick={() => setShowExcluded(!showExcluded)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              showExcluded
                ? "bg-stone-100 text-stone-700 border-stone-300"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {showExcluded ? (
              <><Eye className="h-3.5 w-3.5" /> Showing excluded ({excludedCount})</>
            ) : (
              <><EyeOff className="h-3.5 w-3.5" /> {excludedCount} excluded</>
            )}
          </button>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {cards?.length ?? 0}
        </span>
      </div>

      {/* Entity groups — same component as SDT workflow */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
      ) : (
        <div className="space-y-3">
          {entityGroups.map((group) => (
            <EntityGroup
              key={group.entityId}
              entityId={group.entityId}
              entityName={group.entityName}
              cards={group.cards}
              childGroups={group.childGroups}
              totalCardCount={group.totalCardCount}
              onPunt={() => {}}
              onExclude={() => {}}
              currentUserId={currentUserId}
              onClaim={(mappingId, assigneeId) => claimMutation.mutate({ mappingId, assigneeId })}
              onBatchAssign={(mappingIds, assigneeId) => batchAssignMutation.mutate({ mappingIds, assigneeId })}
            />
          ))}
          {entityGroups.length === 0 && !isLoading && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No mappings match filters
            </div>
          )}
        </div>
      )}

      {distributeOpen && (
        <DistributeDialog
          transferId={transferId}
          onClose={() => setDistributeOpen(false)}
        />
      )}
    </div>
  );
}
