"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useApproveRefresh,
  useRejectRefresh,
  type SkillRefreshSummary,
} from "@/queries/signal-queries";
import { Check, X, Plus, Minus, ArrowRight } from "lucide-react";

interface RefreshProposalCardProps {
  refresh: SkillRefreshSummary;
}

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  auto_applied: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  running: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  pending: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export function RefreshProposalCard({ refresh }: RefreshProposalCardProps) {
  const approve = useApproveRefresh();
  const reject = useRejectRefresh();
  const proposal = refresh.proposal;
  const isProposed = refresh.status === "proposed";

  const totalChanges = proposal
    ? proposal.additions.length +
      proposal.removals.length +
      proposal.roleChanges.length +
      (proposal.instructionUpdate ? 1 : 0)
    : 0;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {refresh.skillName || refresh.skillId}
          </span>
          <Badge
            className={`text-xs ${STATUS_COLORS[refresh.status] || ""}`}
          >
            {refresh.status.replace("_", " ")}
          </Badge>
          {proposal && (
            <span className="text-xs text-muted-foreground">
              risk: {proposal.riskScore}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(refresh.createdAt).toLocaleDateString()}
        </span>
      </div>

      {proposal && totalChanges > 0 && (
        <div className="space-y-2">
          {/* Additions */}
          {proposal.additions.map((add) => (
            <div
              key={add.contextId}
              className="flex items-center gap-2 text-sm py-1 px-2 rounded bg-green-50 dark:bg-green-950/30"
            >
              <Plus className="h-3.5 w-3.5 text-green-600 shrink-0" />
              <span className="truncate">{add.contextName}</span>
              <Badge variant="outline" className="text-xs shrink-0">
                {add.role}
              </Badge>
            </div>
          ))}

          {/* Removals */}
          {proposal.removals.map((rem) => (
            <div
              key={rem.contextId}
              className="flex items-center gap-2 text-sm py-1 px-2 rounded bg-red-50 dark:bg-red-950/30"
            >
              <Minus className="h-3.5 w-3.5 text-red-600 shrink-0" />
              <span className="truncate">{rem.contextName}</span>
            </div>
          ))}

          {/* Role changes */}
          {proposal.roleChanges.map((rc) => (
            <div
              key={rc.contextId}
              className="flex items-center gap-2 text-sm py-1 px-2 rounded bg-blue-50 dark:bg-blue-950/30"
            >
              <ArrowRight className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              <span className="truncate">{rc.contextName}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {rc.fromRole} → {rc.toRole}
              </span>
            </div>
          ))}

          {/* Instruction update */}
          {proposal.instructionUpdate && (
            <div className="text-sm py-1 px-2 rounded bg-muted/50">
              <span className="text-xs font-medium text-muted-foreground">
                Updated instructions:
              </span>
              <p className="text-xs mt-0.5 line-clamp-2">
                {proposal.instructionUpdate}
              </p>
            </div>
          )}
        </div>
      )}

      {proposal && totalChanges === 0 && (
        <p className="text-sm text-muted-foreground">
          No changes proposed — signals did not warrant skill modifications.
        </p>
      )}

      {/* Action buttons for proposed refreshes */}
      {isProposed && totalChanges > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs"
            onClick={() => approve.mutate(refresh.id)}
            disabled={approve.isPending || reject.isPending}
          >
            <Check className="h-3 w-3 mr-1" />
            Approve & Apply
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => reject.mutate(refresh.id)}
            disabled={approve.isPending || reject.isPending}
          >
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
        </div>
      )}

      {/* Info row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{refresh.signalCount} signal{refresh.signalCount !== 1 ? "s" : ""}</span>
        <span>score: {refresh.triggerScore}</span>
        {refresh.reviewedBy && <span>reviewed by: {refresh.reviewedBy}</span>}
      </div>
    </div>
  );
}
