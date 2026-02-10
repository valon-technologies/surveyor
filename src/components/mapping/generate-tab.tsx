"use client";

import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LLM_MODELS } from "@/lib/constants";

interface GenerateTabProps {
  isAutoMapping: boolean;
  autoMapProvider: "claude" | "openai";
  autoMapModel: string;
  autoMapBanner: boolean;
  generationError: string | null;
  isGenerationError: boolean;
  onProviderChange: (p: "claude" | "openai") => void;
  onModelChange: (model: string) => void;
  onAutoMap: () => void;
}

export function GenerateTab({
  isAutoMapping,
  autoMapProvider,
  autoMapModel,
  autoMapBanner,
  generationError,
  isGenerationError,
  onProviderChange,
  onModelChange,
  onAutoMap,
}: GenerateTabProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Provider + Model + Button */}
      <div className="space-y-1.5">
        <div className="flex gap-1.5 items-stretch">
          {/* Provider toggle */}
          <div className="flex rounded-md border border-purple-200 dark:border-purple-800 overflow-hidden shrink-0">
            {(["claude", "openai"] as const).map((p) => (
              <button
                key={p}
                onClick={() => onProviderChange(p)}
                disabled={isAutoMapping}
                className={cn(
                  "px-2 py-1.5 text-[10px] font-medium transition-colors disabled:opacity-50",
                  autoMapProvider === p
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                    : "text-muted-foreground hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                )}
              >
                {p === "claude" ? "Claude" : "GPT"}
              </button>
            ))}
          </div>
          {/* Model selector */}
          <select
            value={autoMapModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isAutoMapping}
            className="flex-1 rounded-md border border-purple-200 dark:border-purple-800 bg-transparent px-2 py-1 text-[10px] font-medium text-purple-700 dark:text-purple-300 disabled:opacity-50"
          >
            {LLM_MODELS[autoMapProvider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {/* Auto-Map button */}
        <button
          onClick={onAutoMap}
          disabled={isAutoMapping}
          className="relative w-full overflow-hidden rounded-md border border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-50 via-white to-purple-50 dark:from-purple-950/40 dark:via-purple-950/20 dark:to-purple-950/40 px-3 py-2 text-xs font-medium text-purple-700 dark:text-purple-300 shadow-sm transition-all hover:border-purple-400 hover:shadow-purple-200/50 dark:hover:border-purple-600 dark:hover:shadow-purple-900/30 hover:shadow-md disabled:opacity-50 disabled:pointer-events-none group"
        >
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-200/40 to-transparent dark:via-purple-400/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
          <span className="relative flex items-center justify-center gap-2">
            {isAutoMapping ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating in background...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Auto-Map This Field
              </>
            )}
          </span>
        </button>
        {isAutoMapping && (
          <p className="text-[11px] text-muted-foreground text-center">
            You can continue editing other fields while this generates
          </p>
        )}
      </div>

      {/* AI suggestion banner */}
      {autoMapBanner && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
          AI suggestion pre-filled — switch to Mapping tab to review and save
        </div>
      )}

      {/* Generation error */}
      {isGenerationError && (
        <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {generationError || "Auto-map failed"}
        </div>
      )}
    </div>
  );
}
