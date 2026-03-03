"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import SchemasPage from "@/app/schemas/page";
import { AtlasClient } from "@/app/atlas/atlas-client";

type Tab = "schemas" | "preview";

export function DataClient() {
  const searchParams = useSearchParams();
  // If the URL has an entityId param, default to preview tab
  const hasEntity = searchParams.has("entityId");
  const [tab, setTab] = useState<Tab>(hasEntity ? "preview" : "schemas");

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
