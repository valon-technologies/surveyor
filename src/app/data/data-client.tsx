"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import SchemasPage from "@/app/schemas/page";
import { AtlasClient } from "@/app/atlas/atlas-client";
import { TopologyClient } from "@/app/topology/topology-client";

type Tab = "schemas" | "preview" | "topology";

export function DataClient() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const hasEntity = searchParams.has("entityId");

  const initialTab: Tab = tabParam && ["schemas", "preview", "topology"].includes(tabParam)
    ? tabParam
    : hasEntity ? "preview" : "schemas";
  const [tab, setTab] = useState<Tab>(initialTab);

  // Sync tab when URL params change (e.g., sidebar click)
  useEffect(() => {
    if (tabParam && ["schemas", "preview", "topology"].includes(tabParam)) {
      setTab(tabParam);
    }
  }, [tabParam]);

  return (
    <div className="h-full flex flex-col">
      {/* Tab Bar */}
      <div className="flex gap-1 border-b px-6 pt-4 shrink-0">
        <TabButton active={tab === "schemas"} onClick={() => setTab("schemas")}>
          Schemas
        </TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
          Preview
        </TabButton>
        <TabButton active={tab === "topology"} onClick={() => setTab("topology")}>
          Topology
        </TabButton>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "schemas" && (
          <div className="h-full overflow-auto">
            <SchemasPage />
          </div>
        )}
        {tab === "preview" && (
          <div className="h-full">
            <AtlasClient />
          </div>
        )}
        {tab === "topology" && (
          <div className="h-full overflow-auto">
            <TopologyClient />
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium transition-colors relative",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-t" />
      )}
    </button>
  );
}
