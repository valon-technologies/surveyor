"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { SotMappingsClient } from "@/app/sot-mappings/sot-mappings-client";
import { EvaluationClient } from "@/app/evaluation/evaluation-client";
import { cn } from "@/lib/utils";

type Tab = "mappings" | "accuracy";

export function GroundTruthClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = (searchParams.get("tab") as Tab) || "mappings";

  const setTab = useCallback(
    (newTab: Tab) => {
      const params = new URLSearchParams();
      params.set("tab", newTab);
      router.replace(`/ground-truth?${params.toString()}`, { scroll: false });
    },
    [router]
  );

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex gap-1 border-b px-4 shrink-0">
        <TabButton active={tab === "mappings"} onClick={() => setTab("mappings")}>
          SOT Mappings
        </TabButton>
        <TabButton active={tab === "accuracy"} onClick={() => setTab("accuracy")}>
          Accuracy
        </TabButton>
      </div>

      {/* Tab content */}
      {tab === "mappings" && (
        <div className="flex-1 overflow-hidden">
          <SotMappingsClient basePath="/ground-truth?tab=mappings" />
        </div>
      )}
      {tab === "accuracy" && (
        <div className="flex-1 overflow-auto">
          <EvaluationClient />
        </div>
      )}
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
