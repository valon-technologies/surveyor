"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAtlasStore } from "@/stores/atlas-store";
import { useEntity } from "@/queries/entity-queries";
import { EntityTreePanel } from "./components/entity-tree-panel";
import { DataPreview } from "./components/data-preview";
import { AtlasEmptySelection } from "./components/atlas-empty";
import { Button } from "@/components/ui/button";
import { Globe, PanelLeftOpen, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function AtlasClient() {
  const searchParams = useSearchParams();
  const {
    leftPanelCollapsed,
    toggleLeftPanel,
    selectedEntityId,
    selectEntity,
  } = useAtlasStore();

  useEffect(() => {
    const entityId = searchParams.get("entityId");
    if (entityId) {
      selectEntity(entityId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="border-b px-4 py-2 flex items-center gap-3 shrink-0">
        <Globe className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Atlas</span>
        <Breadcrumb entityId={selectedEntityId} />
        <div className="flex-1" />
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

        {/* Data preview area */}
        {selectedEntityId ? (
          <DataPreview entityId={selectedEntityId} />
        ) : (
          <AtlasEmptySelection />
        )}
      </div>
    </div>
  );
}

function Breadcrumb({ entityId }: { entityId: string | null }) {
  const { data: entity } = useEntity(entityId || undefined);

  if (!entityId || !entity) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ChevronRight className="h-3 w-3" />
      <span className="text-foreground font-medium">
        {entity.displayName || entity.name}
      </span>
    </div>
  );
}
