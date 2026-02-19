"use client";

import { Plus, Minus, ArrowRightLeft } from "lucide-react";

interface ContextChange {
  contextId: string;
  contextName: string;
  tokenCount?: number;
  change: "added" | "removed" | "role_changed";
  oldRole?: string;
  newRole?: string;
}

interface ForgeContextDiffCardProps {
  changes: ContextChange[];
  tokenDelta: number;
}

export function ForgeContextDiffCard({
  changes,
  tokenDelta,
}: ForgeContextDiffCardProps) {
  if (changes.length === 0) return null;

  const added = changes.filter((c) => c.change === "added");
  const removed = changes.filter((c) => c.change === "removed");
  const roleChanged = changes.filter((c) => c.change === "role_changed");

  return (
    <div className="border-b">
      <div className="p-3 border-b bg-muted/50">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">Context Changes</span>
          <span
            className={`text-xs ${
              tokenDelta > 0
                ? "text-amber-600"
                : tokenDelta < 0
                  ? "text-green-600"
                  : "text-muted-foreground"
            }`}
          >
            {tokenDelta > 0 ? "+" : ""}
            {tokenDelta.toLocaleString()} tokens
          </span>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {added.length > 0 && (
          <div className="space-y-0.5">
            {added.map((c) => (
              <div
                key={c.contextId}
                className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200"
              >
                <Plus className="h-3 w-3 shrink-0" />
                <span className="truncate">{c.contextName}</span>
                {c.tokenCount && (
                  <span className="ml-auto text-[10px] opacity-70 shrink-0">
                    +{c.tokenCount.toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {removed.length > 0 && (
          <div className="space-y-0.5">
            {removed.map((c) => (
              <div
                key={c.contextId}
                className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 px-2 py-1 rounded border border-red-200"
              >
                <Minus className="h-3 w-3 shrink-0" />
                <span className="truncate">{c.contextName}</span>
                {c.tokenCount && (
                  <span className="ml-auto text-[10px] opacity-70 shrink-0">
                    -{c.tokenCount.toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {roleChanged.length > 0 && (
          <div className="space-y-0.5">
            {roleChanged.map((c) => (
              <div
                key={c.contextId}
                className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200"
              >
                <ArrowRightLeft className="h-3 w-3 shrink-0" />
                <span className="truncate">{c.contextName}</span>
                <span className="ml-auto text-[10px] opacity-70 shrink-0">
                  {c.oldRole} → {c.newRole}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
