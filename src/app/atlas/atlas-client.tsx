"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAtlasStore } from "@/stores/atlas-store";
import { useEntity } from "@/queries/entity-queries";
import { EntityTreePanel } from "./components/entity-tree-panel";
import { ReasoningInspector } from "./components/reasoning-inspector";
import { AtlasEmptySelection } from "./components/atlas-empty";
import { Button } from "@/components/ui/button";
import { Globe, PanelLeftOpen, ChevronRight, ExternalLink, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";

export function AtlasClient() {
  const searchParams = useSearchParams();
  const {
    leftPanelCollapsed,
    toggleLeftPanel,
    selectedEntityId,
    selectedFieldId,
    selectedMappingId,
    hydrateFromParams,
  } = useAtlasStore();

  useEffect(() => {
    const entityId = searchParams.get("entityId");
    const fieldId = searchParams.get("fieldId");
    const mappingId = searchParams.get("mappingId");
    const from = searchParams.get("from");
    const fromEntity = searchParams.get("fromEntityId");
    if (entityId || from) {
      hydrateFromParams({
        entityId: entityId || undefined,
        fieldId: fieldId || undefined,
        mappingId: mappingId || undefined,
        from: from || undefined,
        fromEntityId: fromEntity || undefined,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="border-b px-4 py-2 flex items-center gap-3 shrink-0">
        <Globe className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Atlas</span>
        <Breadcrumb
          entityId={selectedEntityId}
          fieldId={selectedFieldId}
        />
        <div className="flex-1" />
        {selectedMappingId && selectedEntityId && selectedFieldId && (
          <Link
            href={`/topology?entityId=${selectedEntityId}&fieldId=${selectedFieldId}&mappingId=${selectedMappingId}`}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Waypoints className="h-3.5 w-3.5" />
            View in Topology
          </Link>
        )}
        {selectedEntityId && (
          <Link
            href={`/mapping?entityId=${selectedEntityId}`}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Mapping Review
          </Link>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel */}
        {!leftPanelCollapsed ? (
          <div className="w-80 border-r bg-background shrink-0 overflow-hidden flex flex-col">
            <EntityTreePanel />
          </div>
        ) : (
          <div className="border-r shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLeftPanel}
              className="h-full px-2 rounded-none"
              title="Expand panel"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Inspector area */}
        {selectedMappingId ? (
          <ReasoningInspector mappingId={selectedMappingId} />
        ) : (
          <AtlasEmptySelection />
        )}
      </div>
    </div>
  );
}

function Breadcrumb({
  entityId,
  fieldId,
}: {
  entityId: string | null;
  fieldId: string | null;
}) {
  const { data: entity } = useEntity(entityId || undefined);

  if (!entityId || !entity) return null;

  const field = fieldId
    ? entity.fields.find((f) => f.id === fieldId)
    : null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ChevronRight className="h-3 w-3" />
      <span>{entity.displayName || entity.name}</span>
      {field && (
        <>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">
            {field.displayName || field.name}
          </span>
        </>
      )}
    </div>
  );
}
