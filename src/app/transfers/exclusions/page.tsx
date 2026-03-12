"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { RotateCcw, Search, Check } from "lucide-react";

interface ExcludedEntity {
  id: string;
  name: string;
  displayName: string | null;
  fieldCount: number;
}

interface ExcludedField {
  mappingId: string;
  entityName: string;
  entityId: string;
  fieldName: string;
  source: string | null;
  transform: string | null;
  confidence: string | null;
  excludeReason: string | null;
}

interface ExclusionsResponse {
  excludedEntities: ExcludedEntity[];
  excludedFields: ExcludedField[];
  stats: { entityCount: number; entityFieldCount: number; fieldCount: number };
}

export default function ExclusionsPage() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<ExclusionsResponse>({
    queryKey: ["exclusions", workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/exclusions`);
      if (!res.ok) throw new Error("Failed to load exclusions");
      return res.json();
    },
    enabled: !!workspaceId,
  });

  const restoreMutation = useMutation({
    mutationFn: async (body: { action: string; entityId?: string; mappingIds?: string[] }) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/exclusions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to restore");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exclusions"] });
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      setSelectedFieldIds(new Set());
    },
  });

  const filteredEntities = useMemo(() => {
    if (!data?.excludedEntities) return [];
    if (!search) return data.excludedEntities;
    const q = search.toLowerCase();
    return data.excludedEntities.filter(
      (e) => e.name.toLowerCase().includes(q) || e.displayName?.toLowerCase().includes(q),
    );
  }, [data?.excludedEntities, search]);

  const filteredFields = useMemo(() => {
    if (!data?.excludedFields) return [];
    if (!search) return data.excludedFields;
    const q = search.toLowerCase();
    return data.excludedFields.filter(
      (f) =>
        f.entityName.toLowerCase().includes(q) ||
        f.fieldName.toLowerCase().includes(q) ||
        f.excludeReason?.toLowerCase().includes(q),
    );
  }, [data?.excludedFields, search]);

  const toggleFieldSelection = (mappingId: string) => {
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(mappingId)) next.delete(mappingId);
      else next.add(mappingId);
      return next;
    });
  };

  const toggleAllFields = () => {
    if (selectedFieldIds.size === filteredFields.length) {
      setSelectedFieldIds(new Set());
    } else {
      setSelectedFieldIds(new Set(filteredFields.map((f) => f.mappingId)));
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-7 bg-muted rounded w-64" />
          <div className="h-24 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const stats = data?.stats;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Servicing Transfer VDS Exclusions
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage excluded entities and fields across all servicing transfer portfolios
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Excluded Entities" value={stats.entityCount} sub={`${stats.entityFieldCount} fields`} />
          <StatCard label="Excluded Fields" value={stats.fieldCount} />
          <StatCard label="Total Excluded" value={stats.entityFieldCount + stats.fieldCount} />
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search entities or fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Excluded Entities */}
      {filteredEntities.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Excluded Entities</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2.5 font-medium">Entity</th>
                  <th className="text-right px-4 py-2.5 font-medium w-24">Fields</th>
                  <th className="text-right px-4 py-2.5 font-medium w-32" />
                </tr>
              </thead>
              <tbody>
                {filteredEntities.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {e.displayName || e.name}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                      {e.fieldCount}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() =>
                          restoreMutation.mutate({ action: "restore-entity", entityId: e.id })
                        }
                        disabled={restoreMutation.isPending}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore All
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Excluded Fields */}
      {filteredFields.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Excluded Fields</h2>
            {selectedFieldIds.size > 0 && (
              <button
                onClick={() =>
                  restoreMutation.mutate({
                    action: "restore-fields",
                    mappingIds: Array.from(selectedFieldIds),
                  })
                }
                disabled={restoreMutation.isPending}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "disabled:opacity-50",
                )}
              >
                <RotateCcw className="h-3 w-3" /> Restore {selectedFieldIds.size} Fields
              </button>
            )}
          </div>
          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-3 py-2.5 font-medium w-8">
                      <input
                        type="checkbox"
                        checked={selectedFieldIds.size === filteredFields.length && filteredFields.length > 0}
                        onChange={toggleAllFields}
                        className="rounded border-muted-foreground/30"
                      />
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium">Entity</th>
                    <th className="text-left px-3 py-2.5 font-medium">Field</th>
                    <th className="text-left px-3 py-2.5 font-medium">Source</th>
                    <th className="text-left px-3 py-2.5 font-medium">Transform</th>
                    <th className="text-left px-3 py-2.5 font-medium">Confidence</th>
                    <th className="text-left px-3 py-2.5 font-medium">Reason</th>
                    <th className="text-right px-3 py-2.5 font-medium w-20" />
                  </tr>
                </thead>
                <tbody>
                  {filteredFields.map((f) => (
                    <tr
                      key={f.mappingId}
                      className={cn(
                        "border-b last:border-0 transition-colors",
                        selectedFieldIds.has(f.mappingId) ? "bg-primary/5" : "hover:bg-muted/30",
                      )}
                    >
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedFieldIds.has(f.mappingId)}
                          onChange={() => toggleFieldSelection(f.mappingId)}
                          className="rounded border-muted-foreground/30"
                        />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{f.entityName}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{f.fieldName}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground max-w-[150px] truncate">
                        {f.source || "\u2014"}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground max-w-[150px] truncate">
                        {f.transform || "\u2014"}
                      </td>
                      <td className="px-3 py-1.5">
                        {f.confidence && (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                              f.confidence === "high"
                                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                : f.confidence === "medium"
                                  ? "bg-amber-100 text-amber-800 border-amber-200"
                                  : "bg-red-100 text-red-800 border-red-200",
                            )}
                          >
                            {f.confidence}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[150px] truncate">
                        {f.excludeReason || "\u2014"}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() =>
                            restoreMutation.mutate({
                              action: "restore-fields",
                              mappingIds: [f.mappingId],
                            })
                          }
                          disabled={restoreMutation.isPending}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : filteredEntities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {search
              ? "No exclusions match your search."
              : "No exclusions. Entities and fields excluded from servicing transfer review will appear here."}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{value.toLocaleString()}</p>
      {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
