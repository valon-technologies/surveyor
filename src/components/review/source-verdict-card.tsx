"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUpdateMappingVerdict } from "@/queries/mapping-queries";
import { Check } from "lucide-react";

interface SourceVerdictCardProps {
  mappingId: string;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  initialVerdict?: string | null;
  initialNotes?: string | null;
  onVerdictChange?: (verdict: string) => void;
  suggestedSource?: string | null;
  onAcceptSuggestion?: () => void;
  suggestionApplied?: boolean;
  aiHasOpinion?: boolean;
}

export function SourceVerdictCard({
  mappingId,
  sourceEntityName,
  sourceFieldName,
  initialVerdict,
  initialNotes,
  onVerdictChange,
  suggestedSource,
  onAcceptSuggestion,
  suggestionApplied,
  aiHasOpinion,
}: SourceVerdictCardProps) {
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<"current" | "suggested" | "custom" | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const mutation = useUpdateMappingVerdict();

  const sourceLabel =
    sourceEntityName && sourceFieldName
      ? `${sourceEntityName}.${sourceFieldName}`
      : sourceEntityName || sourceFieldName || "— unmapped —";

  const aiAgrees = suggestedSource && suggestedSource === sourceLabel;
  const aiDiffers = suggestedSource && suggestedSource !== sourceLabel;

  async function save(newVerdict: string, newNotes: string) {
    if (!newVerdict) return;
    setSaveStatus("saving");
    try {
      await mutation.mutateAsync({
        id: mappingId,
        sourceVerdict: newVerdict,
        sourceVerdictNotes: newNotes || undefined,
      });
      setSaveStatus("saved");
      onVerdictChange?.(newVerdict);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  }

  function handleSelectCurrent() {
    if (selected === "current") {
      setSelected(null);
      onVerdictChange?.("");
      return;
    }
    setSelected("current");
    save("correct", "");
  }

  function handleSelectSuggested() {
    if (selected === "suggested") {
      setSelected(null);
      onVerdictChange?.("");
      return;
    }
    setSelected("suggested");
    onAcceptSuggestion?.();
    // Save as "wrong" so the learning pipeline captures the correction
    save("wrong", `Accepted AI suggestion: ${suggestedSource}`);
  }

  function handleSelectCustom() {
    if (selected === "custom" && !notes.trim()) {
      setSelected(null);
      onVerdictChange?.("");
      return;
    }
    setSelected("custom");
    if (notes.trim()) {
      save("wrong", notes);
    }
  }

  function handleNotesBlur() {
    if (selected === "custom" && notes.trim()) {
      save("wrong", notes);
    }
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Source</span>
        {saveStatus === "saving" && (
          <span className="text-[10px] text-muted-foreground">saving…</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-[10px] text-green-500">saved</span>
        )}
      </div>

      {(() => {
        return (
          <>
            {/* Current source — with AI confirmation badge if AI agrees */}
            <button
              onClick={handleSelectCurrent}
              className={cn(
                "w-full flex items-start gap-2 text-left text-[11px] font-mono rounded px-2 py-1 border transition-colors",
                selected === "current"
                  ? "border-green-400 bg-green-50 dark:bg-green-950/30 dark:border-green-700"
                  : "border-border bg-muted/50 hover:border-muted-foreground/30"
              )}
            >
              <span className={cn(
                "shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center mt-0.5",
                selected === "current" ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground/30"
              )}>
                {selected === "current" && <Check className="w-2.5 h-2.5" />}
              </span>
              <span className="flex-1 break-words whitespace-pre-wrap">{sourceLabel}</span>
              {aiAgrees ? (
                <span className="text-[9px] text-green-600 shrink-0 mt-0.5">AI Review confirms</span>
              ) : (
                <span className="text-[9px] text-muted-foreground shrink-0 mt-0.5">current</span>
              )}
            </button>

            {/* AI suggestion — only if different from current */}
            {aiDiffers && (
              <button
                onClick={handleSelectSuggested}
                className={cn(
                  "w-full flex items-start gap-2 text-left text-[11px] font-mono rounded px-2 py-1 border transition-colors",
                  selected === "suggested" || suggestionApplied
                    ? "border-green-400 bg-green-50 dark:bg-green-950/30 dark:border-green-700"
                    : "border-blue-300 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-700 hover:border-blue-400"
                )}
              >
                <span className={cn(
                  "shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center mt-0.5",
                  selected === "suggested" || suggestionApplied
                    ? "bg-green-500 border-green-500 text-white"
                    : "border-blue-400"
                )}>
                  {(selected === "suggested" || suggestionApplied) && <Check className="w-2.5 h-2.5" />}
                </span>
                <span className="flex-1 break-words whitespace-pre-wrap">{suggestedSource}</span>
                <span className="text-[9px] text-blue-500 shrink-0 mt-0.5">AI Review</span>
              </button>
            )}

            {/* AI confirms but no specific suggestion */}
            {!suggestedSource && aiHasOpinion && (
              <div className="w-full flex items-center gap-2 text-[11px] rounded px-2 py-1 border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-700">
                <span className="text-green-700 dark:text-green-400">AI Review confirms current</span>
              </div>
            )}
          </>
        );
      })()}

      {/* Custom — checkbox + free text */}
      <div className={cn(
        "flex items-start gap-2 rounded px-2 py-1 border transition-colors",
        selected === "custom"
          ? "border-green-400 bg-green-50 dark:bg-green-950/30 dark:border-green-700"
          : "border-border bg-background hover:border-muted-foreground/30"
      )}>
        <button
          onClick={handleSelectCustom}
          className="shrink-0 mt-1"
        >
          <span className={cn(
            "w-3.5 h-3.5 rounded border flex items-center justify-center",
            selected === "custom" ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground/30"
          )}>
            {selected === "custom" && <Check className="w-2.5 h-2.5" />}
          </span>
        </button>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            if (e.target.value.trim()) setSelected("custom");
          }}
          onBlur={handleNotesBlur}
          onFocus={() => { if (notes.trim()) setSelected("custom"); }}
          placeholder="Correct source (specify)"
          rows={2}
          className={cn(
            "flex-1 text-xs bg-transparent px-0 py-0 resize-none border-0 focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
          )}
        />
      </div>
    </div>
  );
}
