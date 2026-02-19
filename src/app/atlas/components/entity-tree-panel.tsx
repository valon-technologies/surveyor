"use client";

import { useMemo } from "react";
import { useEntities } from "@/queries/entity-queries";
import { useAtlasStore } from "@/stores/atlas-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Component, Layers, PanelLeftClose, Search, Table } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types/entity";

type EntityRow = Entity & { fieldCount: number; statusBreakdown: Record<string, number> };

interface EntityGroup {
  entity: EntityRow;
  children: EntityRow[];
  isAssembly: boolean;
}

export function EntityTreePanel() {
  const { data: entities, isLoading } = useEntities({ side: "target" });
  const {
    selectedEntityId,
    selectEntity,
    searchQuery,
    setSearchQuery,
    toggleLeftPanel,
  } = useAtlasStore();

  // Build hierarchical groups, then filter by search
  const groups = useMemo<EntityGroup[]>(() => {
    if (!entities) return [];

    const childMap = new Map<string, EntityRow[]>();
    const childIds = new Set<string>();

    for (const e of entities) {
      if (e.parentEntityId) {
        childIds.add(e.id);
        const siblings = childMap.get(e.parentEntityId) || [];
        siblings.push(e);
        childMap.set(e.parentEntityId, siblings);
      }
    }

    const result: EntityGroup[] = [];
    for (const e of entities) {
      if (childIds.has(e.id)) continue;
      const children = (childMap.get(e.id) || []).sort((a, b) =>
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
      );
      result.push({
        entity: e,
        children,
        isAssembly: children.length > 0,
      });
    }

    // Filter by search query — include group if parent or any child matches
    const q = searchQuery.toLowerCase();
    if (!q) return result;

    return result.filter((g) => {
      const parentMatch =
        g.entity.name.toLowerCase().includes(q) ||
        (g.entity.displayName || "").toLowerCase().includes(q);
      const childMatch = g.children.some(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.displayName || "").toLowerCase().includes(q)
      );
      return parentMatch || childMatch;
    });
  }, [entities, searchQuery]);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto p-1">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground animate-pulse">
            Loading entities...
          </div>
        ) : groups.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">
            No matching entities
          </div>
        ) : (
          groups.map((group) => {
            const isSelected = selectedEntityId === group.entity.id;

            return (
              <div key={group.entity.id}>
                <button
                  onClick={() => selectEntity(group.entity.id)}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 text-xs rounded-md transition-colors text-left",
                    isSelected
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-muted text-foreground/80"
                  )}
                >
                  {group.isAssembly ? (
                    <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Table className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate flex-1">
                    {group.entity.displayName || group.entity.name}
                  </span>
                </button>

                {/* Child entities indented */}
                {group.children.map((child) => {
                  const childSelected = selectedEntityId === child.id;
                  return (
                    <button
                      key={child.id}
                      onClick={() => selectEntity(child.id)}
                      className={cn(
                        "flex items-center gap-1.5 w-full pl-8 pr-3 py-1.5 text-xs rounded-md transition-colors text-left",
                        childSelected
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-muted text-muted-foreground"
                      )}
                    >
                      <Component className="h-3 w-3 shrink-0" />
                      <span className="truncate flex-1">
                        {child.displayName || child.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
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
