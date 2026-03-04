"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, workspacePath } from "@/lib/api-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  MILESTONES,
  MILESTONE_LABELS,
  MILESTONE_COLORS,
  MAPPING_STATUS_LABELS,
  MAPPING_STATUS_COLORS,
  type Milestone,
  type MappingStatus,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { FieldRow } from "@/app/api/workspaces/[workspaceId]/fields/route";

export default function VdsFieldsByMilestonePage() {
  const { workspaceId } = useWorkspace();
  const [milestone, setMilestone] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showSystem, setShowSystem] = useState<string>("hide");

  const { data: fields, isLoading } = useQuery({
    queryKey: ["fields", workspaceId, milestone],
    queryFn: () =>
      api.get<FieldRow[]>(
        workspacePath(workspaceId, "fields"),
        milestone !== "all" ? { milestone } : undefined,
      ),
  });

  // Derive entity options from data
  const entityOptions = useMemo(() => {
    if (!fields) return [];
    const names = new Set(fields.map((f) => f.entityName));
    return Array.from(names).sort();
  }, [fields]);

  // System field detection
  const SYSTEM_SUFFIXES = ["_id", "_sid", "_at"];
  const SYSTEM_EXACT = ["id", "created_at", "updated_at", "deleted_at", "loan_id"];

  function isSystemField(f: FieldRow): boolean {
    const name = f.fieldName.toLowerCase();
    if (SYSTEM_EXACT.includes(name)) return true;
    if (f.isKey) return true;
    // FK pattern: ends with _id or _sid (but not fields like "tax_id_number")
    if ((name.endsWith("_id") || name.endsWith("_sid")) && !name.includes("number") && !name.includes("amount")) return true;
    if (name === "created_at" || name === "updated_at" || name === "deleted_at") return true;
    return false;
  }

  // Filter
  const filtered = useMemo(() => {
    if (!fields) return [];
    return fields.filter((f) => {
      if (entityFilter !== "all" && f.entityName !== entityFilter) return false;
      if (statusFilter === "unmapped" && f.mappingStatus !== null) return false;
      if (statusFilter === "mapped" && f.mappingStatus === null) return false;
      if (statusFilter !== "all" && statusFilter !== "unmapped" && statusFilter !== "mapped" && f.mappingStatus !== statusFilter) return false;
      const sys = isSystemField(f);
      if (showSystem === "hide" && sys) return false;
      if (showSystem === "only" && !sys) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          f.fieldName.toLowerCase().includes(q) ||
          f.entityName.toLowerCase().includes(q) ||
          (f.description || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [fields, entityFilter, statusFilter, showSystem, search]);

  // Stats
  const totalCount = fields?.length ?? 0;
  const mappedCount = fields?.filter((f) => f.mappingStatus && f.mappingStatus !== "unmapped").length ?? 0;
  const unmappedCount = totalCount - mappedCount;

  const milestoneOptions = [
    { value: "all", label: "All Milestones" },
    ...MILESTONES.map((m) => ({ value: m, label: MILESTONE_LABELS[m] || m })),
  ];

  const statusOptions = [
    { value: "all", label: "All Statuses" },
    { value: "mapped", label: "Has Mapping" },
    { value: "unmapped", label: "No Mapping" },
    { value: "accepted", label: "Accepted" },
    { value: "unreviewed", label: "Unreviewed" },
    { value: "punted", label: "Punted" },
    { value: "excluded", label: "Excluded" },
  ];

  const entitySelectOptions = [
    { value: "all", label: `All Entities (${entityOptions.length})` },
    ...entityOptions.map((e) => ({ value: e, label: e })),
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">VDS Fields by Milestone</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {totalCount} fields · {mappedCount} mapped · {unmappedCount} unmapped
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          options={milestoneOptions}
          value={milestone}
          onChange={(e) => { setMilestone(e.target.value); setEntityFilter("all"); }}
          className="w-40"
        />
        <Select
          options={entitySelectOptions}
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="w-52"
        />
        <Select
          options={statusOptions}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-36"
        />
        <Select
          options={[
            { value: "hide", label: "Hide System Fields" },
            { value: "show", label: "All Fields" },
            { value: "only", label: "System Fields Only" },
          ]}
          value={showSystem}
          onChange={(e) => setShowSystem(e.target.value)}
          className="w-44"
        />
        <input
          type="text"
          placeholder="Search fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded-md bg-background w-48 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {totalCount} fields
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-sm" style={{tableLayout: "fixed"}}>
              <colgroup>
                <col style={{width: "130px"}} />
                <col style={{width: "160px"}} />
                <col style={{width: "65px"}} />
                <col style={{width: "40px"}} />
                <col style={{width: "55px"}} />
                <col style={{width: "220px"}} />
                <col style={{width: "80px"}} />
                <col style={{width: "160px"}} />
                <col style={{width: "220px"}} />
                <col style={{width: "70px"}} />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted text-left">
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Entity</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Field</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Type</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Kind</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">MS</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Definition</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Status</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Source Field(s)</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Transform</th>
                  <th className="px-2 py-2 font-medium text-xs text-muted-foreground">Linear</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((f) => (
                  <tr key={f.fieldId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-2 py-1.5">
                      <code className="text-[11px] text-muted-foreground break-all">{f.entityName}</code>
                    </td>
                    <td className="px-2 py-1.5">
                      <code className="text-[11px] font-medium break-all">{f.fieldName}</code>
                      {f.isKey && <span className="ml-1 text-[9px] text-amber-600">PK</span>}
                      {f.isRequired && <span className="ml-1 text-[9px] text-red-500">req</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="text-[11px] text-muted-foreground font-mono">{f.dataType || "—"}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      {isSystemField(f) ? (
                        <span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5">
                          {f.isKey ? "PK" : f.fieldName.endsWith("_id") || f.fieldName.endsWith("_sid") ? "FK" : "sys"}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {f.milestone ? (
                        <span className="text-[10px] font-medium px-1 py-0.5 rounded"
                              style={{ backgroundColor: `${MILESTONE_COLORS[f.milestone as Milestone]}20`, color: MILESTONE_COLORS[f.milestone as Milestone] }}>
                          {f.milestone}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="text-[11px] text-muted-foreground line-clamp-3">
                        {f.description || "—"}
                      </span>
                      {f.enumValues && f.enumValues.length > 0 && (
                        <span className="text-[10px] text-blue-500" title={f.enumValues.join(", ")}>
                          ({f.enumValues.length} enums)
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {f.mappingStatus ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] whitespace-nowrap"
                          style={{
                            borderColor: MAPPING_STATUS_COLORS[f.mappingStatus as MappingStatus] || "#6b7280",
                            color: MAPPING_STATUS_COLORS[f.mappingStatus as MappingStatus] || "#6b7280",
                          }}
                        >
                          {MAPPING_STATUS_LABELS[f.mappingStatus as MappingStatus] || f.mappingStatus}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {f.sourceEntityName && f.sourceFieldName && !f.sourceFieldName.startsWith("string_field_") ? (
                        <code className="text-[10px] text-foreground/70 break-all">
                          {f.sourceEntityName}.{f.sourceFieldName}
                        </code>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {f.transform ? (
                        <code className="text-[10px] text-foreground/70 line-clamp-3 break-all" title={f.transform}>
                          {f.transform}
                        </code>
                      ) : f.sourceFieldName ? (
                        <span className="text-[10px] text-green-600 font-medium">DIRECT</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {f.linearIssueId ? (
                        <a
                          href={`https://linear.app/valon/issue/${f.linearIssueId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-500 hover:underline"
                        >
                          {f.linearIssueId}
                        </a>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
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
