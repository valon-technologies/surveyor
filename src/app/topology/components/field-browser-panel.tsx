"use client";

import { useMemo, useState } from "react";
import { useEntities, useEntity } from "@/queries/entity-queries";
import { useTopologyStore } from "@/stores/topology-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  ChevronDown,
  Code2,
  PanelLeftClose,
  Search,
  Component,
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
import { FieldInlineCode } from "./field-inline-code";

export function FieldBrowserPanel() {
  const { data: entities, isLoading } = useEntities({ side: "target" });
  const {
    expandedEntityIds,
    toggleEntity,
    selectEntity,
    selectField,
    selectedEntityId,
    selectedFieldId,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    toggleLeftPanel,
  } = useTopologyStore();

  // Separate top-level entities from children, build parent→children map
  const { topLevelEntities, childrenByParent } = useMemo(() => {
    if (!entities) return { topLevelEntities: [], childrenByParent: new Map<string, typeof entities>() };
    const childMap = new Map<string, typeof entities>();
    const topLevel: typeof entities = [];

    for (const e of entities) {
      if (e.parentEntityId) {
        const siblings = childMap.get(e.parentEntityId) || [];
        siblings.push(e);
        childMap.set(e.parentEntityId, siblings);
      } else {
        topLevel.push(e);
      }
    }
    return { topLevelEntities: topLevel, childrenByParent: childMap };
  }, [entities]);

  const filteredEntities = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return topLevelEntities.filter((e) => {
      if (
        q &&
        !e.name.toLowerCase().includes(q) &&
        !(e.displayName || "").toLowerCase().includes(q)
      ) {
        // Also show parent if any child matches the search
        const children = childrenByParent.get(e.id) || [];
        const childMatch = children.some(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.displayName || "").toLowerCase().includes(q)
        );
        if (!childMatch) return false;
      }
      return true;
    });
  }, [topLevelEntities, childrenByParent, searchQuery]);

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
              isEntitySelected={
                selectedEntityId === entity.id && !selectedFieldId
              }
              onToggle={() => toggleEntity(entity.id)}
              onSelectEntity={() => selectEntity(entity.id)}
              selectedFieldId={selectedFieldId}
              selectedEntityId={selectedEntityId}
              onSelectField={selectField}
              statusFilter={statusFilter}
              searchQuery={searchQuery}
              childEntities={childrenByParent.get(entity.id)}
              onSelectChildEntity={selectEntity}
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
  isEntitySelected,
  onToggle,
  onSelectEntity,
  selectedFieldId,
  selectedEntityId,
  onSelectField,
  statusFilter,
  searchQuery,
  childEntities,
  onSelectChildEntity,
}: {
  entityId: string;
  entityName: string;
  fieldCount: number;
  isExpanded: boolean;
  isEntitySelected: boolean;
  onToggle: () => void;
  onSelectEntity: () => void;
  selectedFieldId: string | null;
  selectedEntityId: string | null;
  onSelectField: (
    entityId: string,
    fieldId: string,
    mappingId: string | null
  ) => void;
  statusFilter: "all" | "mapped" | "unmapped";
  searchQuery: string;
  childEntities?: Array<{ id: string; name: string; displayName: string | null; fieldCount: number }>;
  onSelectChildEntity: (entityId: string) => void;
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
      <div
        className={cn(
          "flex items-center gap-1.5 w-full px-2 py-1.5 text-xs rounded-md transition-colors text-left",
          isEntitySelected
            ? "bg-primary/10 text-primary"
            : "hover:bg-muted"
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="shrink-0 p-0.5 rounded hover:bg-muted-foreground/10"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={onSelectEntity}
          className="font-medium truncate flex-1 text-left"
        >
          {entityName}
        </button>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {displayCount}
        </span>
      </div>

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
                entityName={entityName}
                isSelected={selectedFieldId === f.id}
                onSelect={() =>
                  onSelectField(entityId, f.id, f.mapping?.id ?? null)
                }
              />
            ))
          )}
          {/* Component sub-entities nested under assembly parent */}
          {childEntities && childEntities.length > 0 && (
            <div className="mt-1 mb-1">
              <div className="px-3 py-1 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                Components
              </div>
              {childEntities.map((child) => (
                <ComponentEntityNode
                  key={child.id}
                  entityId={child.id}
                  entityName={child.displayName || child.name}
                  fieldCount={child.fieldCount}
                  isEntitySelected={selectedEntityId === child.id && !selectedFieldId}
                  selectedFieldId={selectedFieldId}
                  onSelectEntity={() => onSelectChildEntity(child.id)}
                  onSelectField={onSelectField}
                  statusFilter={statusFilter}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComponentEntityNode({
  entityId,
  entityName,
  fieldCount,
  isEntitySelected,
  selectedFieldId,
  onSelectEntity,
  onSelectField,
  statusFilter,
  searchQuery,
}: {
  entityId: string;
  entityName: string;
  fieldCount: number;
  isEntitySelected: boolean;
  selectedFieldId: string | null;
  onSelectEntity: () => void;
  onSelectField: (entityId: string, fieldId: string, mappingId: string | null) => void;
  statusFilter: "all" | "mapped" | "unmapped";
  searchQuery: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
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

  const displayCount =
    statusFilter !== "all" && entityDetail
      ? visibleFields.length
      : fieldCount;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] rounded-md transition-colors text-left",
          isEntitySelected
            ? "bg-primary/10 text-primary"
            : "hover:bg-muted"
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="shrink-0 p-0.5 rounded hover:bg-muted-foreground/10"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
        <Component className="h-3 w-3 text-muted-foreground shrink-0" />
        <button
          onClick={onSelectEntity}
          className="font-medium truncate flex-1 text-left"
        >
          {entityName}
        </button>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {displayCount}
        </span>
      </div>

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
                entityName={entityName}
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
  entityName,
  isSelected,
  onSelect,
}: {
  field: FieldWithMapping;
  entityId: string;
  entityName: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMapping = !!field.mapping && field.mapping.status !== "unmapped";
  const status = hasMapping
    ? (field.mapping!.status as MappingStatus)
    : "unmapped";
  const statusColor = MAPPING_STATUS_COLORS[status] || "#6b7280";
  const mappingType = hasMapping
    ? (field.mapping!.mappingType as MappingType | null)
    : null;

  return (
    <div>
      <div
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
        <button onClick={onSelect} className="truncate flex-1 text-left">
          {field.displayName || field.name}
        </button>
        {mappingType ? (
          <span className="text-[9px] text-muted-foreground shrink-0">
            {MAPPING_TYPE_LABELS[mappingType]}
          </span>
        ) : (
          <span className="text-[9px] text-muted-foreground/50 shrink-0">
            Unmapped
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className={cn(
            "shrink-0 p-0.5 rounded hover:bg-muted-foreground/10",
            isExpanded && "text-primary"
          )}
          title={isExpanded ? "Collapse code" : "Expand code"}
        >
          <Code2 className="h-3 w-3" />
        </button>
      </div>
      {isExpanded && (
        <FieldInlineCode
          field={field}
          entityId={entityId}
          entityName={entityName}
        />
      )}
    </div>
  );
}
