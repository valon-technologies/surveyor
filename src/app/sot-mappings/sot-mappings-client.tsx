"use client";

import { useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSotMappingStore } from "@/stores/sot-mapping-store";
import { useSotMappingList } from "@/queries/sot-mapping-queries";
import { SotEntityListPanel } from "./components/entity-list-panel";
import { SotMappingDetail } from "./components/mapping-detail";
import { SotMappingsEmpty } from "./components/empty-state";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, PanelLeftOpen, ChevronRight } from "lucide-react";

export function SotMappingsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { leftPanelCollapsed, toggleLeftPanel, collapseAllFields } =
    useSotMappingStore();

  const entityName = searchParams.get("entity");
  const milestone = (searchParams.get("milestone") || "m1") as "m1" | "m2";

  const { data } = useSotMappingList();

  const selectEntity = useCallback(
    (name: string, ms: "m1" | "m2") => {
      collapseAllFields();
      router.replace(`/sot-mappings?entity=${name}&milestone=${ms}`, {
        scroll: false,
      });
    },
    [router, collapseAllFields]
  );

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="border-b px-4 py-2 flex items-center gap-3 shrink-0">
        <FileSpreadsheet className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">SOT Mappings</span>
        {entityName && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium font-mono">
              {entityName}
            </span>
            <span className="text-muted-foreground">
              ({milestone.toUpperCase()})
            </span>
          </div>
        )}
        <div className="flex-1" />
        {data?.stats && (
          <span className="text-xs text-muted-foreground">
            {data.stats.m1Count} M1 + {data.stats.m2Count} M2 entities
            &middot; {data.stats.totalFields.toLocaleString()} fields
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel */}
        {!leftPanelCollapsed ? (
          <div className="w-80 border-r bg-background shrink-0 overflow-hidden flex flex-col">
            <SotEntityListPanel
              entities={data?.entities || []}
              selectedEntity={entityName}
              selectedMilestone={milestone}
              onSelect={selectEntity}
            />
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

        {/* Detail area */}
        {entityName ? (
          <SotMappingDetail entityName={entityName} milestone={milestone} />
        ) : (
          <SotMappingsEmpty />
        )}
      </div>
    </div>
  );
}
