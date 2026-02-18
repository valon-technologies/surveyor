"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTopologyStore } from "@/stores/topology-store";
import { useMapping } from "@/queries/mapping-queries";
import { useEntity } from "@/queries/entity-queries";
import { FieldBrowserPanel } from "./components/field-browser-panel";
import { LineageDiagram } from "./components/lineage-diagram";
import { CodePanel, EntityCodePanel } from "./components/code-panel";
import { EntityPipelineOverview } from "./components/entity-pipeline-overview";
import {
  TopologyEmptySelection,
  TopologyNoMapping,
} from "./components/topology-empty";
import { Button } from "@/components/ui/button";
import {
  Waypoints,
  PanelLeftOpen,
  PanelRightOpen,
  Globe,
} from "lucide-react";

export function TopologyClient() {
  const searchParams = useSearchParams();
  const {
    selectedEntityId,
    selectedFieldId,
    selectedMappingId,
    leftPanelCollapsed,
    rightPanelCollapsed,
    toggleLeftPanel,
    toggleRightPanel,
    selectEntity,
    hydrateFromParams,
  } = useTopologyStore();

  useEffect(() => {
    const entityId = searchParams.get("entityId");
    const fieldId = searchParams.get("fieldId");
    const mappingId = searchParams.get("mappingId");
    if (entityId) {
      hydrateFromParams({
        entityId: entityId || undefined,
        fieldId: fieldId || undefined,
        mappingId: mappingId || undefined,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: mapping, isLoading: mappingLoading } = useMapping(
    selectedMappingId ?? undefined
  );
  const { data: entity } = useEntity(selectedEntityId ?? undefined);
  const { data: parentEntity } = useEntity(
    entity?.parentEntityId ?? undefined
  );

  const selectedField = entity?.fields?.find(
    (f) => f.id === selectedFieldId
  );

  // Breadcrumb — show parent > component when viewing a component entity
  const entityLabel = entity?.displayName || entity?.name || "";
  const parentLabel = parentEntity?.displayName || parentEntity?.name || "";
  const isComponent = !!entity?.parentEntityId && !!parentEntity;

  const isEntityOnlyView = !!selectedEntityId && !selectedFieldId;

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="border-b px-4 py-2 flex items-center gap-3">
        <Waypoints className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Topology</span>
        {isComponent && (
          <>
            <span className="text-muted-foreground text-xs">/</span>
            <button
              onClick={() => selectEntity(entity!.parentEntityId!)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
            >
              {parentLabel}
            </button>
            <span className="text-muted-foreground text-xs">/</span>
            <span className="text-xs text-muted-foreground truncate">
              {entityLabel}
            </span>
          </>
        )}
        {!isComponent && selectedField && (
          <>
            <span className="text-muted-foreground text-xs">/</span>
            <span className="text-xs text-muted-foreground truncate">
              {entityLabel} / {selectedField.displayName || selectedField.name}
            </span>
          </>
        )}
        {!isComponent && !selectedField && selectedEntityId && entityLabel && (
          <>
            <span className="text-muted-foreground text-xs">/</span>
            <span className="text-xs text-muted-foreground truncate">
              {entityLabel}
            </span>
          </>
        )}
        <div className="flex-1" />
        {selectedMappingId && selectedEntityId && selectedFieldId && (
          <Link
            href={`/atlas?entityId=${selectedEntityId}&fieldId=${selectedFieldId}&mappingId=${selectedMappingId}`}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Globe className="h-3.5 w-3.5" />
            View in Atlas
          </Link>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: field browser */}
        {leftPanelCollapsed ? (
          <div className="border-r p-2 flex flex-col items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLeftPanel}
              className="h-8 w-8 p-0"
              title="Expand field browser"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="w-72 border-r shrink-0">
            <FieldBrowserPanel />
          </div>
        )}

        {/* Center: diagram or entity overview */}
        <div className="flex-1 overflow-hidden">
          {isEntityOnlyView ? (
            <EntityPipelineOverview
              entityId={selectedEntityId!}
              entityName={entityLabel}
            />
          ) : !selectedFieldId ? (
            <TopologyEmptySelection />
          ) : !selectedMappingId ? (
            <TopologyNoMapping />
          ) : mappingLoading ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="animate-pulse text-sm text-muted-foreground">
                Loading mapping...
              </div>
            </div>
          ) : mapping ? (
            <LineageDiagram mapping={mapping} />
          ) : (
            <TopologyNoMapping />
          )}
        </div>

        {/* Right panel: code (field-level or entity-level) */}
        {(isEntityOnlyView || (selectedMappingId && mapping)) && (
          rightPanelCollapsed ? (
            <div className="border-l p-2 flex flex-col items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleRightPanel}
                className="h-8 w-8 p-0"
                title="Expand code panel"
              >
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="w-96 border-l shrink-0">
              {isEntityOnlyView ? (
                <EntityCodePanel entityId={selectedEntityId!} />
              ) : (
                <CodePanel mapping={mapping!} />
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
