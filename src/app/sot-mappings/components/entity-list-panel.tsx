"use client";

import { useMemo, useState } from "react";
import { useSotMappingStore } from "@/stores/sot-mapping-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EntitySummary {
  name: string;
  milestone: "m1" | "m2";
  fieldCount: number;
  sourceCount: number;
  structureType: "concat" | "join" | "simple";
  hasOnboardingConfig: boolean;
  isAssemblyParent: boolean;
  stagingComponents: string[];
  isStagingComponent: boolean;
}

interface SotEntityListPanelProps {
  entities: EntitySummary[];
  selectedEntity: string | null;
  selectedMilestone: "m1" | "m2";
  onSelect: (name: string, milestone: "m1" | "m2") => void;
}

const structureBadge: Record<
  string,
  { label: string; className: string }
> = {
  simple: { label: "simple", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  join: { label: "join", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  concat: { label: "concat", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

export function SotEntityListPanel({
  entities,
  selectedEntity,
  selectedMilestone,
  onSelect,
}: SotEntityListPanelProps) {
  const { searchQuery, setSearchQuery, toggleLeftPanel } =
    useSotMappingStore();

  const [m1Collapsed, setM1Collapsed] = useState(false);
  const [m2Collapsed, setM2Collapsed] = useState(false);

  const { m1Entities, m2Entities } = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? entities.filter((e) => e.name.toLowerCase().includes(q))
      : // Hide staging components from top-level list (shown nested under parents)
        entities.filter((e) => !e.isStagingComponent);

    return {
      m1Entities: filtered.filter((e) => e.milestone === "m1"),
      m2Entities: filtered.filter((e) => e.milestone === "m2"),
    };
  }, [entities, searchQuery]);

  // Build lookup for staging component summaries (for nested display)
  const componentLookup = useMemo(() => {
    const map = new Map<string, EntitySummary>();
    for (const e of entities) {
      map.set(`${e.milestone}:${e.name}`, e);
    }
    return map;
  }, [entities]);

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
        {/* M1 Section */}
        <SectionHeader
          label={`M1 (${m1Entities.length} entities, ${m1Entities.reduce((s, e) => s + e.fieldCount, 0)} fields)`}
          collapsed={m1Collapsed}
          onToggle={() => setM1Collapsed(!m1Collapsed)}
        />
        {!m1Collapsed &&
          m1Entities.map((entity) => (
            <EntityWithComponents
              key={`m1-${entity.name}`}
              entity={entity}
              milestone="m1"
              componentLookup={componentLookup}
              selectedEntity={selectedEntity}
              selectedMilestone={selectedMilestone}
              onSelect={onSelect}
            />
          ))}

        {/* M2 Section */}
        <SectionHeader
          label={`M2 (${m2Entities.length} entities, ${m2Entities.reduce((s, e) => s + e.fieldCount, 0)} fields)`}
          collapsed={m2Collapsed}
          onToggle={() => setM2Collapsed(!m2Collapsed)}
        />
        {!m2Collapsed &&
          m2Entities.map((entity) => (
            <EntityWithComponents
              key={`m2-${entity.name}`}
              entity={entity}
              milestone="m2"
              componentLookup={componentLookup}
              selectedEntity={selectedEntity}
              selectedMilestone={selectedMilestone}
              onSelect={onSelect}
            />
          ))}
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

function SectionHeader({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
    >
      {collapsed ? (
        <ChevronRight className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3" />
      )}
      {label}
    </button>
  );
}

function EntityWithComponents({
  entity,
  milestone,
  componentLookup,
  selectedEntity,
  selectedMilestone,
  onSelect,
}: {
  entity: EntitySummary;
  milestone: "m1" | "m2";
  componentLookup: Map<string, EntitySummary>;
  selectedEntity: string | null;
  selectedMilestone: "m1" | "m2";
  onSelect: (name: string, milestone: "m1" | "m2") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedEntity === entity.name && selectedMilestone === milestone;

  return (
    <div>
      <div className="flex items-center">
        {/* Expand toggle for assembly parents */}
        {entity.isAssemblyParent && entity.stagingComponents.length > 0 ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-muted-foreground hover:text-foreground shrink-0"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <EntityRow
            entity={entity}
            isSelected={isSelected}
            onSelect={() => onSelect(entity.name, milestone)}
          />
        </div>
      </div>
      {/* Nested staging components */}
      {expanded && entity.stagingComponents.map((compName) => {
        const comp = componentLookup.get(`${milestone}:${compName}`);
        if (!comp) return null;
        const compSelected = selectedEntity === compName && selectedMilestone === milestone;
        return (
          <div key={compName} className="pl-5">
            <EntityRow
              entity={comp}
              isSelected={compSelected}
              onSelect={() => onSelect(compName, milestone)}
              isNested
            />
          </div>
        );
      })}
    </div>
  );
}

function EntityRow({
  entity,
  isSelected,
  onSelect,
  isNested,
}: {
  entity: EntitySummary;
  isSelected: boolean;
  onSelect: () => void;
  isNested?: boolean;
}) {
  const badge = structureBadge[entity.structureType];

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 w-full px-3 py-2 text-xs rounded-md transition-colors text-left",
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "hover:bg-muted text-foreground/80"
      )}
    >
      {/* Onboarding indicator */}
      {entity.hasOnboardingConfig && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0"
          title="Has onboarding config"
        />
      )}

      {/* Entity name */}
      <span className={cn(
        "font-mono text-xs truncate flex-1",
        isNested && "text-muted-foreground"
      )}>
        {isNested ? `↳ ${entity.name}` : entity.name}
      </span>

      {/* Field count */}
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {entity.fieldCount}
      </span>

      {/* Structure type badge */}
      {badge && (
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
            badge.className
          )}
        >
          {badge.label}
        </span>
      )}
    </button>
  );
}
