"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ContextLibrary } from "@/components/context/context-library";
import { SkillsPageContent } from "@/components/skills/skills-page-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

type Tab = "library" | "skills";

export default function ContextPage() {
  return (
    <Suspense>
      <ContextPageInner />
    </Suspense>
  );
}

function ContextPageInner() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("id") ?? undefined;
  const tabParam = searchParams.get("tab");

  // Default to library tab, but if ?tab=skills is set, show skills.
  // When ?id=X is present (deep link), always default to library.
  const initialTab: Tab =
    highlightId ? "library" : tabParam === "skills" ? "skills" : "library";
  const [tab, setTab] = useState<Tab>(initialTab);

  // Sync tab state if search params change externally
  useEffect(() => {
    if (highlightId) {
      setTab("library");
    } else if (tabParam === "skills") {
      setTab("skills");
    }
  }, [highlightId, tabParam]);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between px-8 pt-8 pb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Context</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Domain knowledge, schema references, and working documents
          </p>
        </div>
        {tab === "library" && (
          <Link href="/context/new">
            <Button>
              <Plus className="h-4 w-4 mr-1.5" />
              New Context
            </Button>
          </Link>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b px-8 shrink-0">
        <TabButton active={tab === "library"} onClick={() => setTab("library")}>
          Library
        </TabButton>
        <TabButton active={tab === "skills"} onClick={() => setTab("skills")}>
          Skills
        </TabButton>
      </div>

      {/* Tab Content */}
      {tab === "library" && (
        <div className="flex-1 overflow-hidden px-8 pt-4">
          <ContextLibrary highlightContextId={highlightId} />
        </div>
      )}

      {tab === "skills" && (
        <div className="flex-1 overflow-y-auto px-8 pt-4 pb-8">
          <SkillsPageContent />
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
