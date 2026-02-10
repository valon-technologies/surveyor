"use client";

import { useMemo } from "react";
import { useEntities, useEntity } from "@/queries/entity-queries";
import { useTopologyStore } from "@/stores/topology-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  Search,
} from "lucide-react";
import {
  MAPPING_STATUS_COLORS,
  MAPPING_STATUS_LABELS,
  MAPPING_TYPE_LABELS,
  type MappingStatus,
  type MappingType,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { FieldWithMapping } from "@/types/field";

export function FieldBrowserPanel() {
  const { data: entities, isLoading } = useEntities({ side: "target" });
  const {
    expandedEntityIds,
    toggleEntity,
    selectField,
    selectedFieldId,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    toggleLeftPanel,
  } = useTopologyStore();

  const filteredEntities = useMemo(() => {
    if (!entities) return [];
    const q = searchQuery.toLowerCase();
    return entities.filter((e) => {
      if (
        q &&
        !e.name.toLowerCase().includes(q) &&
        !(e.displayName || "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [entities, searchQuery]);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        {/* Status filter */}
        <div className="flex gap-1">
          {(["all", "mapped", "unmapped"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                "text-[10px] px-2 py-1 rounded-md transition-colors",
                statusFilter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? "All" : f === "mapped" ? "Mapped" : "Unmapped"}
            </button>
          ))}
        </div>
      </div>

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto p-1">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground animate-pulse">
            Loading entities...
          </div>
        ) : filteredEntities.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">
            No matching entities
          </div>
        ) : (
          filteredEntities.map((entity) => (
            <EntityNode
              key={entity.id}
              entityId={entity.id}
              entityName={entity.displayName || entity.name}
              fieldCount={entity.fieldCount}
              isExpanded={expandedEntityIds.includes(entity.id)}
              onToggle={() => toggleEntity(entity.id)}
              selectedFieldId={selectedFieldId}
              onSelectField={selectField}
              statusFilter={statusFilter}
              searchQuery={searchQuery}
            />
          ))
        )}
      </div>

      {/* Collapse button */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLeftPanel}
          className="w-full text-xs text-muted-foreground"
        >
          <PanelLeftClose className="h-3.5 w-3.5 mr-1.5" />
          Collapse
        </Button>
      </div>
    </div>
  );
}

function EntityNode({
  entityId,
  entityName,
  fieldCount,
  isExpanded,
  onToggle,
  selectedFieldId,
  onSelectField,
  statusFilter,
  searchQuery,
}: {
  entityId: string;
  entityName: string;
  fieldCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  selectedFieldId: string | null;
  onSelectField: (
    entityId: string,
    fieldId: string,
    mappingId: string | null
  ) => void;
  statusFilter: "all" | "mapped" | "unmapped";
  searchQuery: string;
}) {
  // Fetch entity detail when expanded OR when a filter is active (so we can hide empty entities)
  const needsDetail = isExpanded || statusFilter !== "all";
  const { data: entityDetail } = useEntity(needsDetail ? entityId : undefined);

  const visibleFields = useMemo(() => {
    if (!entityDetail?.fields) return [];
    return entityDetail.fields.filter((f: FieldWithMapping) => {
      const hasMapping = !!f.mapping && f.mapping.status !== "unmapped";
      if (statusFilter === "mapped" && !hasMapping) return false;
      if (statusFilter === "unmapped" && hasMapping) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const nameMatch =
          f.name.toLowerCase().includes(q) ||
          (f.displayName || "").toLowerCase().includes(q);
        const entityMatch = entityName.toLowerCase().includes(q);
        if (!nameMatch && !entityMatch) return false;
      }
      return true;
    });
  }, [entityDetail?.fields, statusFilter, searchQuery, entityName]);

  // When a filter is active and detail has loaded, hide entity if 0 matching fields
  if (statusFilter !== "all" && entityDetail && visibleFields.length === 0) {
    return null;
  }

  // Show filtered count when filter is active and detail is loaded
  const displayCount =
    statusFilter !== "all" && entityDetail
      ? visibleFields.length
      : fieldCount;

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs hover:bg-muted rounded-md transition-colors text-left"
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium truncate flex-1">{entityName}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {displayCount}
        </span>
      </button>

      {isExpanded && (
        <div className="ml-3 border-l pl-1">
          {!entityDetail ? (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground animate-pulse">
              Loading...
            </div>
          ) : visibleFields.length === 0 ? (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
              No matching fields
            </div>
          ) : (
            visibleFields.map((f: FieldWithMapping) => (
              <FieldNode
                key={f.id}
                field={f}
                entityId={entityId}
                isSelected={selectedFieldId === f.id}
                onSelect={() =>
                  onSelectField(entityId, f.id, f.mapping?.id ?? null)
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FieldNode({
  field,
  entityId,
  isSelected,
  onSelect,
}: {
  field: FieldWithMapping;
  entityId: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const hasMappig = !!field.mapping && field.mapping.status !== "unmapped";
  const status = hasMappig
    ? (field.mapping!.status as MappingStatus)
    : "unmapped";
  const statusColor = MAPPING_STATUS_COLORS[status] || "#6b7280";
  const mappingType = hasMappig
    ? (field.mapping!.mappingType as MappingType | null)
    : null;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 w-full px-3 py-1.5 text-[11px] rounded-md transition-colors text-left",
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "hover:bg-muted text-foreground/80"
      )}
    >
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: statusColor }}
        title={MAPPING_STATUS_LABELS[status]}
      />
      <span className="truncate flex-1">
        {field.displayName || field.name}
      </span>
      {mappingType ? (
        <span className="text-[9px] text-muted-foreground shrink-0">
          {MAPPING_TYPE_LABELS[mappingType]}
        </span>
      ) : (
        <span className="text-[9px] text-muted-foreground/50 shrink-0">
          Unmapped
        </span>
      )}
    </button>
  );
}
