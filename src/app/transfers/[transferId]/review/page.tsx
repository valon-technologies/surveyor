"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { useWorkspaceMembers } from "@/queries/member-queries";
import { useToast } from "@/components/ui/toast";
import { api, workspacePath } from "@/lib/api-client";
import { ArrowLeft, ChevronRight, Users, EyeOff, Eye, XCircle, UserCheck, ChevronDown } from "lucide-react";
import { DistributeDialog } from "@/components/review/distribute-dialog";

interface TransferMapping {
  id: string;
  targetFieldId: string;
  targetFieldName: string;
  entityId: string;
  entityName: string;
  entityMetadata: Record<string, unknown> | null;
  parentEntityId: string | null;
  parentEntityName: string | null;
  status: string;
  confidence: string | null;
  mappingType: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  reasoning: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
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
  const { data: session } = useSession();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);

  const { data: members } = useWorkspaceMembers();
  const { role } = useWorkspace();
  const isAdmin = role === "owner";

  const claimMutation = useMutation({
    mutationFn: ({ mappingId, assigneeId }: { mappingId: string; assigneeId: string | null }) =>
      api.patch(workspacePath(workspaceId, `mappings/${mappingId}`), { assigneeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-review-queue"] });
    },
  });

  const batchAssignMutation = useMutation({
    mutationFn: ({ mappingIds, assigneeId }: { mappingIds: string[]; assigneeId: string | null }) =>
      api.post(workspacePath(workspaceId, "mappings/batch-assign"), { mappingIds, assigneeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-review-queue"] });
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

  // Determine which entities are transfer-excluded
  const excludedEntityIds = useMemo(() => {
    if (!mappings) return new Set<string>();
    const ids = new Set<string>();
    for (const m of mappings) {
      if (m.entityMetadata?.transferExcluded === true) {
        ids.add(m.entityId);
      }
    }
    return ids;
  }, [mappings]);

  const excludedCount = useMemo(() => excludedEntityIds.size, [excludedEntityIds]);

  // Compute domains from entity names
  const domains = useMemo(() => {
    if (!mappings) return [];
    const set = new Set(mappings.map((m) => m.parentEntityName || m.entityName));
    return Array.from(set).sort();
  }, [mappings]);

  // Compute status counts (respecting entity exclusion filter)
  const statusCounts = useMemo(() => {
    if (!mappings) return {};
    const counts: Record<string, number> = {};
    for (const m of mappings) {
      if (!showExcluded && excludedEntityIds.has(m.entityId)) continue;
      counts[m.status] = (counts[m.status] || 0) + 1;
    }
    return counts;
  }, [mappings, showExcluded, excludedEntityIds]);

  // Filter and sort
  const filtered = useMemo(() => {
    if (!mappings) return [];
    return mappings
      .filter((m) => {
        // Entity-level transfer exclusion
        if (!showExcluded && excludedEntityIds.has(m.entityId)) return false;
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
  }, [mappings, statusFilter, confidenceFilter, domainFilter, search, showExcluded, excludedEntityIds]);

  // Total visible (excluding entity-level exclusions when hidden)
  const visibleTotal = useMemo(() => {
    if (!mappings) return 0;
    if (showExcluded) return mappings.length;
    return mappings.filter((m) => !excludedEntityIds.has(m.entityId)).length;
  }, [mappings, showExcluded, excludedEntityIds]);

  // Group filtered mappings by entity for rendering entity headers
  const groupedByEntity = useMemo(() => {
    const groups: { entityId: string; entityName: string; isExcluded: boolean; mappings: TransferMapping[] }[] = [];
    const entityMap = new Map<string, TransferMapping[]>();
    const entityNames = new Map<string, string>();
    const entityOrder: string[] = [];
    for (const m of filtered) {
      if (!entityMap.has(m.entityId)) {
        entityMap.set(m.entityId, []);
        entityNames.set(m.entityId, m.entityName);
        entityOrder.push(m.entityId);
      }
      entityMap.get(m.entityId)!.push(m);
    }
    for (const entityId of entityOrder) {
      groups.push({
        entityId,
        entityName: entityNames.get(entityId) || entityId,
        isExcluded: excludedEntityIds.has(entityId),
        mappings: entityMap.get(entityId)!,
      });
    }
    return groups;
  }, [filtered, excludedEntityIds]);

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

        // Invalidate to refresh data
        queryClient.invalidateQueries({ queryKey: ["transfer-review-queue"] });

        addToast({
          type: "success",
          title: exclude
            ? `${entityName} excluded from review`
            : `${entityName} restored to review`,
          action: {
            label: "Undo",
            onClick: () => toggleEntityExclusion(entityId, entityName, !exclude),
          },
        });
      } catch {
        addToast({
          type: "error",
          title: "Failed to update entity",
        });
      }
    },
    [workspaceId, queryClient, addToast]
  );

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

        {/* Excluded entity toggle */}
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
          {filtered.length} of {visibleTotal}
        </span>
      </div>

      {/* Mapping list grouped by entity */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className="px-4 py-2.5 font-medium w-10">Claim</th>
                <th className="px-4 py-2.5 font-medium">Entity / Field</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Confidence</th>
                <th className="px-4 py-2.5 font-medium w-8"></th>
              </tr>
            </thead>
            <tbody>
              {groupedByEntity.map((group) => (
                <EntityGroup
                  key={group.entityId}
                  group={group}
                  onToggleExclude={toggleEntityExclusion}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  members={members}
                  onClaim={(mappingId, assigneeId) => claimMutation.mutate({ mappingId, assigneeId })}
                  onBatchAssign={(mappingIds, assigneeId) => batchAssignMutation.mutate({ mappingIds, assigneeId })}
                />
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

      {distributeOpen && (
        <DistributeDialog
          transferId={transferId}
          onClose={() => setDistributeOpen(false)}
        />
      )}
    </div>
  );
}

function EntityGroup({
  group,
  onToggleExclude,
  currentUserId,
  isAdmin,
  members,
  onClaim,
  onBatchAssign,
}: {
  group: {
    entityId: string;
    entityName: string;
    isExcluded: boolean;
    mappings: TransferMapping[];
  };
  onToggleExclude: (entityId: string, entityName: string, exclude: boolean) => void;
  currentUserId: string | null;
  isAdmin: boolean;
  members?: { userId: string; name: string | null; email: string }[];
  onClaim: (mappingId: string, assigneeId: string | null) => void;
  onBatchAssign: (mappingIds: string[], assigneeId: string | null) => void;
}) {
  const allMappingIds = group.mappings.map((m) => m.id);
  const allClaimedByMe = currentUserId && group.mappings.length > 0 &&
    group.mappings.every((m) => m.assigneeId === currentUserId);
  const someClaimedByMe = currentUserId &&
    group.mappings.some((m) => m.assigneeId === currentUserId);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);

  return (
    <>
      {/* Entity header row */}
      <tr className="bg-muted/30 border-b">
        <td className="px-4 py-1.5 text-center">
          {isAdmin ? (
            <div className="relative inline-block">
              <button
                onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground rounded px-1 py-0.5 hover:bg-muted"
                title="Assign all fields in this entity"
              >
                <Users className="h-3 w-3" />
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
              {showAssignDropdown && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-md py-1 min-w-[160px]">
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-muted-foreground"
                    onClick={() => { onBatchAssign(allMappingIds, null); setShowAssignDropdown(false); }}
                  >
                    Unassign all
                  </button>
                  {members?.map((m) => (
                    <button
                      key={m.userId}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                      onClick={() => { onBatchAssign(allMappingIds, m.userId); setShowAssignDropdown(false); }}
                    >
                      {m.name || m.email}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <input
              type="checkbox"
              checked={!!allClaimedByMe}
              ref={(el) => { if (el) el.indeterminate = !!someClaimedByMe && !allClaimedByMe; }}
              onChange={() => {
                if (!currentUserId) return;
                onBatchAssign(allMappingIds, allClaimedByMe ? null : currentUserId);
              }}
              title={allClaimedByMe ? "Release all fields" : "Claim all fields in this entity"}
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary cursor-pointer"
            />
          )}
        </td>
        <td colSpan={4} className="px-4 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {group.entityName}
            </span>
            <span className="text-xs text-muted-foreground">
              ({group.mappings.length} {group.mappings.length === 1 ? "field" : "fields"})
            </span>
            {group.isExcluded && (
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 text-stone-600 px-2 py-0.5 text-[10px] font-medium">
                excluded
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-1.5 text-right">
          <button
            onClick={() =>
              onToggleExclude(group.entityId, group.entityName, !group.isExcluded)
            }
            title={group.isExcluded ? "Restore to review queue" : "Exclude from transfer review"}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted"
          >
            {group.isExcluded ? (
              <><Eye className="h-3 w-3" /> Restore</>
            ) : (
              <><XCircle className="h-3 w-3" /> Not needed</>
            )}
          </button>
        </td>
      </tr>
      {/* Mapping rows */}
      {group.mappings.map((m) => {
        const isMine = currentUserId && m.assigneeId === currentUserId;
        const claimedByOther = m.assigneeId && m.assigneeId !== currentUserId;
        return (
        <tr key={m.id} className={`border-b last:border-0 hover:bg-muted/50 group ${claimedByOther ? "opacity-50" : ""}`}>
          <td className="px-4 py-2.5 text-center">
            {isAdmin ? (
              <span
                className={`text-[10px] cursor-pointer ${m.assigneeName ? "text-foreground" : "text-muted-foreground"}`}
                title={m.assigneeName ? `Assigned to ${m.assigneeName} — click to change` : "Unassigned — click to assign"}
                onClick={() => {
                  // For admin: cycle through unassign on click, use entity-level dropdown for full picker
                  if (m.assigneeId) {
                    onClaim(m.id, null);
                  } else if (currentUserId) {
                    onClaim(m.id, currentUserId);
                  }
                }}
              >
                {m.assigneeName ? (
                  <UserCheck className="h-3.5 w-3.5 inline text-green-600" />
                ) : (
                  <input type="checkbox" checked={false} readOnly className="h-3.5 w-3.5 rounded border-gray-300 cursor-pointer" />
                )}
              </span>
            ) : claimedByOther ? (
              <span className="text-[10px] text-muted-foreground" title={`Claimed by ${m.assigneeName}`}>
                <UserCheck className="h-3.5 w-3.5 inline text-amber-500" />
              </span>
            ) : (
              <input
                type="checkbox"
                checked={!!isMine}
                onChange={() => {
                  if (!currentUserId) return;
                  onClaim(m.id, isMine ? null : currentUserId);
                }}
                title={isMine ? "Release this field" : "Claim for review"}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary cursor-pointer"
              />
            )}
          </td>
          <td className="px-4 py-2.5">
            <div className="font-medium pl-3">{m.targetFieldName}</div>
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
        );
      })}
    </>
  );
}
