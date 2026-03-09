"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { Loader2, Users, ArrowRight } from "lucide-react";
import {
  FIELD_DOMAIN_LABELS,
  FIELD_DOMAIN_COLORS,
  type FieldDomain,
} from "@/lib/constants";
import type { DistributeResponse } from "@/types/distribute";

interface DistributeDialogProps {
  onClose: () => void;
  /** When set, distribution is scoped to this transfer's mappings. */
  transferId?: string;
}

export function DistributeDialog({ onClose, transferId }: DistributeDialogProps) {
  const { workspaceId } = useWorkspace();
  const [strategy, setStrategy] = useState<"round_robin" | "least_loaded">("least_loaded");
  const [preview, setPreview] = useState<DistributeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDistribute(dryRun: boolean) {
    const setter = dryRun ? setLoading : setApplying;
    setter(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/mappings/distribute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy,
            dryRun,
            eligibleStatuses: ["unmapped", "unreviewed"],
            ...(transferId ? { transferId } : {}),
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      const data: DistributeResponse = await res.json();
      if (dryRun) {
        setPreview(data);
      } else {
        setApplied(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setter(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-semibold">Distribute Fields</h3>
        <p className="text-sm text-muted-foreground">
          Auto-assign unmapped and unreviewed fields to team members based on
          their domain specialties.
        </p>

        {/* Strategy picker */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Strategy</label>
          <div className="flex gap-2">
            {(["least_loaded", "round_robin"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setStrategy(s); setPreview(null); }}
                className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                  strategy === s
                    ? "border-foreground/20 bg-accent font-medium"
                    : "border-transparent hover:bg-accent/50"
                }`}
              >
                {s === "least_loaded" ? "Least Loaded" : "Round Robin"}
              </button>
            ))}
          </div>
        </div>

        {/* Preview results */}
        {preview && (
          <div className="border rounded-lg p-3 space-y-3">
            <div className="text-sm font-medium">
              Preview: {preview.summary.assigned} fields to assign
              {preview.summary.skipped > 0 && (
                <span className="text-muted-foreground font-normal">
                  {" "}({preview.summary.skipped} skipped — no matching users)
                </span>
              )}
            </div>

            {/* By assignee */}
            {preview.summary.byAssignee.filter((a) => a.count > 0).length > 0 && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  By Member
                </span>
                {preview.summary.byAssignee
                  .filter((a) => a.count > 0)
                  .sort((a, b) => b.count - a.count)
                  .map((a) => (
                    <div key={a.userId} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3 w-3 text-muted-foreground" />
                        {a.name || "Unknown"}
                      </span>
                      <Badge variant="secondary">{a.count}</Badge>
                    </div>
                  ))}
              </div>
            )}

            {/* By domain */}
            {preview.summary.byDomain.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  By Domain
                </span>
                {preview.summary.byDomain
                  .sort((a, b) => b.count - a.count)
                  .map((d) => (
                    <div key={d.domain ?? "none"} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        {d.domain ? (
                          <>
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: FIELD_DOMAIN_COLORS[d.domain as FieldDomain] }}
                            />
                            {FIELD_DOMAIN_LABELS[d.domain as FieldDomain]}
                          </>
                        ) : (
                          <span className="text-muted-foreground">No domain</span>
                        )}
                      </span>
                      <Badge variant="secondary">{d.count}</Badge>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Applied confirmation */}
        {applied && (
          <div className="border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-3 text-sm text-emerald-700 dark:text-emerald-400">
            Fields have been assigned. Refresh the review queue to see assignments.
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            {applied ? "Done" : "Cancel"}
          </Button>
          {!applied && !preview && (
            <Button onClick={() => runDistribute(true)} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Previewing...
                </>
              ) : (
                "Preview"
              )}
            </Button>
          )}
          {preview && !applied && (
            <Button onClick={() => runDistribute(false)} disabled={applying || preview.summary.assigned === 0}>
              {applying ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <ArrowRight className="h-3.5 w-3.5" />
                  Assign {preview.summary.assigned} Fields
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
