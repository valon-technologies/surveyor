"use client";

import { useState, useEffect } from "react";
import { Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreateQuestion } from "@/queries/question-queries";

interface CreateQuestionCardProps {
  workspaceId: string;
  entityId: string;
  fieldId: string;
  fieldMappingId: string;
  onCreated?: () => void;
  suggestedQuestion?: string | null;
  onAcceptSuggestion?: () => void;
  suggestionApplied?: boolean;
  aiHasOpinion?: boolean;
  onDecisionMade?: () => void;
}

export function CreateQuestionCard({
  workspaceId,
  entityId,
  fieldId,
  fieldMappingId,
  onCreated,
  suggestedQuestion,
  onAcceptSuggestion,
  suggestionApplied,
  aiHasOpinion,
  onDecisionMade,
}: CreateQuestionCardProps) {
  const [questionText, setQuestionText] = useState("");
  const [targetTeam, setTargetTeam] = useState("SM");
  const [selected, setSelected] = useState<"suggested" | "custom" | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const createMutation = useCreateQuestion();

  // When AI says no question needed, auto-report decision
  useEffect(() => {
    if (aiHasOpinion && !suggestedQuestion) {
      onDecisionMade?.();
    }
  }, [aiHasOpinion, suggestedQuestion]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(text?: string) {
    const submitText = text || questionText.trim();
    if (!submitText) return;
    setSaveStatus("saving");
    try {
      await createMutation.mutateAsync({
        entityId,
        fieldId,
        fieldMappingId,
        question: submitText,
        targetForTeam: targetTeam,
        priority: "normal",
      });
      setSaveStatus("saved");
      setQuestionText("");
      onDecisionMade?.();
      setTimeout(() => {
        setSaveStatus("idle");
        onCreated?.();
      }, 1500);
    } catch {
      setSaveStatus("idle");
    }
  }

  function handleSelectSuggested() {
    setSelected("suggested");
    onAcceptSuggestion?.();
    onDecisionMade?.();
    if (suggestedQuestion) {
      handleSubmit(suggestedQuestion);
    }
  }

  function handleSelectCustom() {
    setSelected("custom");
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Question</span>
        {saveStatus === "saving" && (
          <span className="text-[10px] text-muted-foreground">saving…</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-[10px] text-green-500">created</span>
        )}
      </div>

      {/* AI suggested question or confirmation */}
      {suggestedQuestion ? (
        <button
          onClick={handleSelectSuggested}
          className={cn(
            "w-full flex items-start gap-2 text-left text-[11px] rounded px-2 py-1 border transition-colors",
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
          <span className="flex-1 leading-relaxed">{suggestedQuestion}</span>
          <span className="text-[9px] text-blue-500 shrink-0 mt-0.5">AI Review</span>
        </button>
      ) : aiHasOpinion ? (
        <div className="w-full flex items-center gap-2 text-[11px] rounded px-2 py-1 border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-700">
          <span className="shrink-0 w-3.5 h-3.5 rounded border bg-green-500 border-green-500 text-white flex items-center justify-center">
            <Check className="w-2.5 h-2.5" />
          </span>
          <span className="text-green-700 dark:text-green-400">AI Review: no question needed</span>
        </div>
      ) : null}

      {/* Custom question — checkbox + free text */}
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
          value={questionText}
          onChange={(e) => {
            setQuestionText(e.target.value);
            if (e.target.value.trim()) setSelected("custom");
          }}
          onFocus={() => { if (questionText.trim()) setSelected("custom"); }}
          placeholder="Your question (specify)"
          rows={2}
          className={cn(
            "flex-1 text-xs bg-transparent px-0 py-0 resize-none border-0 focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
          )}
        />
      </div>

      {/* Team selector + submit for custom questions */}
      {selected === "custom" && questionText.trim() && (
        <div className="flex items-center justify-between">
          <select
            value={targetTeam}
            onChange={(e) => setTargetTeam(e.target.value)}
            className={cn(
              "text-xs rounded border bg-background px-2 py-1",
              "border-border focus:outline-none focus:ring-1 focus:ring-ring"
            )}
          >
            <option value="SM">For ServiceMac</option>
            <option value="VT">For Valon Tech</option>
          </select>
          <button
            onClick={() => handleSubmit()}
            disabled={saveStatus === "saving"}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border bg-primary text-primary-foreground border-primary hover:bg-primary/90"
          >
            <Plus className="h-3 w-3" />
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
