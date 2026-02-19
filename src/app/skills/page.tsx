"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { SkillList } from "@/components/skills/skill-list";
import { AssemblySimulator } from "@/components/skills/assembly-simulator";
import { SignalQueuePanel } from "@/components/forge/signal-queue-panel";
import { RefreshProposalCard } from "@/components/forge/refresh-proposal-card";
import { Button } from "@/components/ui/button";
import { useEntities } from "@/queries/entity-queries";
import { useSkillRefreshes } from "@/queries/signal-queries";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { api, workspacePath } from "@/lib/api-client";
import { Plus, Hammer, RefreshCw, X } from "lucide-react";

export default function SkillsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const [showEntityPicker, setShowEntityPicker] = useState(false);
  const [entitySearch, setEntitySearch] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<{
    total: number;
    created: number;
    skipped: number;
    contextLinks: number;
  } | null>(null);
  const { data: entities } = useEntities({ side: "target" });

  const { data: pendingRefreshes } = useSkillRefreshes("proposed");

  const filteredEntities = (entities ?? []).filter((e) =>
    (e.displayName || e.name)
      .toLowerCase()
      .includes(entitySearch.toLowerCase())
  );

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Curated context bundles for mapping tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={regenerating}
            onClick={async () => {
              if (!window.confirm(
                "This will rebuild all skills from current schema and context data. Continue?"
              )) return;
              setRegenerating(true);
              setRegenResult(null);
              try {
                const result = await api.post<{
                  total: number;
                  created: number;
                  skipped: number;
                  contextLinks: number;
                }>(workspacePath(workspaceId, "skills/regenerate"));
                setRegenResult(result);
                queryClient.invalidateQueries({ queryKey: ["skills"] });
              } catch (err) {
                window.alert(`Regeneration failed: ${(err as Error).message}`);
              } finally {
                setRegenerating(false);
              }
            }}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating..." : "Regenerate All"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowEntityPicker(!showEntityPicker)}
          >
            <Hammer className="h-4 w-4 mr-1.5" />
            Forge Skill
          </Button>
          <Link href="/skills/new">
            <Button>
              <Plus className="h-4 w-4 mr-1.5" />
              New Skill
            </Button>
          </Link>
        </div>
      </div>

      {/* Entity picker for Forge */}
      {showEntityPicker && (
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">
              Select a target entity to forge a skill for:
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowEntityPicker(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <input
            type="text"
            placeholder="Filter entities..."
            value={entitySearch}
            onChange={(e) => setEntitySearch(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md mb-2 bg-background"
          />
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filteredEntities.map((e) => (
              <button
                key={e.id}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted rounded-md transition-colors"
                onClick={() => {
                  const name = encodeURIComponent(e.displayName || e.name);
                  router.push(`/skills/forge/${name}`);
                }}
              >
                {e.displayName || e.name}
                <span className="text-muted-foreground ml-2 text-xs">
                  {e.fieldCount} fields
                </span>
              </button>
            ))}
            {filteredEntities.length === 0 && (
              <p className="text-sm text-muted-foreground px-3 py-1.5">
                No matching entities
              </p>
            )}
          </div>
        </div>
      )}

      {/* Regeneration result banner */}
      {regenResult && (
        <div className="border rounded-lg p-3 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 flex items-center justify-between">
          <span className="text-sm text-green-800 dark:text-green-200">
            Regenerated {regenResult.created} skills with{" "}
            {regenResult.contextLinks} context links
            {regenResult.skipped > 0 && (
              <> ({regenResult.skipped} skipped — no VDS context match)</>
            )}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setRegenResult(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Skill Signals & Pending Refreshes */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Signals</h2>
        <SignalQueuePanel />
        {pendingRefreshes && pendingRefreshes.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Pending Proposals ({pendingRefreshes.length})
            </h3>
            {pendingRefreshes.map((r) => (
              <RefreshProposalCard key={r.id} refresh={r} />
            ))}
          </div>
        )}
      </div>

      <SkillList />

      <div className="border-t pt-6">
        <AssemblySimulator />
      </div>
    </div>
  );
}
