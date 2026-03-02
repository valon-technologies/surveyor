"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateQuestionFeedback } from "@/queries/question-queries";

const WHY_NOT_OPTIONS = [
  { value: "too_vague", label: "Too vague" },
  { value: "wrong_thing", label: "Asks the wrong thing" },
  { value: "already_answered", label: "Already answered elsewhere" },
  { value: "not_needed", label: "Not needed" },
] as const;

interface QuestionFeedbackCardProps {
  questionId: string;
  questionText: string;
  initialHelpful?: boolean | null;
  initialWhyNot?: string | null;
  initialBetterQuestion?: string | null;
  onDecisionMade?: () => void;
}

export function QuestionFeedbackCard({
  questionId,
  questionText,
  initialHelpful,
  initialWhyNot,
  initialBetterQuestion,
  onDecisionMade,
}: QuestionFeedbackCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [helpful, setHelpful] = useState<boolean | null>(initialHelpful ?? null);
  const [whyNot, setWhyNot] = useState(initialWhyNot ?? "");
  const [betterQuestion, setBetterQuestion] = useState(initialBetterQuestion ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const mutation = useUpdateQuestionFeedback();

  async function save(updates: Omit<Parameters<typeof mutation.mutateAsync>[0], "id">) {
    setSaveStatus("saving");
    try {
      await mutation.mutateAsync({ id: questionId, ...updates });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  }

  function handleHelpfulToggle(value: boolean) {
    setHelpful(value);
    save({ feedbackHelpful: value });
    onDecisionMade?.();
  }

  function handleWhyNotChange(value: string) {
    setWhyNot(value);
    save({ feedbackHelpful: false, feedbackWhyNot: value });
  }

  function handleBetterQuestionBlur() {
    if (helpful === false) {
      save({
        feedbackHelpful: false,
        feedbackWhyNot: whyNot || undefined,
        feedbackBetterQuestion: betterQuestion || undefined,
      });
    }
  }

  const statusIndicator =
    helpful === true ? "✓ helpful" : helpful === false ? "✗ not helpful" : null;

  return (
    <div className="border-b">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <HelpCircle className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Question</span>
        {statusIndicator && (
          <span
            className={cn(
              "text-[10px]",
              helpful ? "text-green-500" : "text-amber-500"
            )}
          >
            {statusIndicator}
          </span>
        )}
        {saveStatus === "saving" && (
          <span className="text-[10px] text-muted-foreground">saving…</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-[10px] text-green-500">saved ✓</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-[11px] text-foreground/80 bg-muted/50 rounded px-2 py-1.5 leading-relaxed">
            {questionText}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              Is this question acceptable?
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => handleHelpfulToggle(true)}
                className={cn(
                  "px-2 py-0.5 text-[11px] rounded border transition-colors",
                  helpful === true
                    ? "bg-green-500/10 border-green-500/30 text-green-600"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                Yes
              </button>
              <button
                onClick={() => handleHelpfulToggle(false)}
                className={cn(
                  "px-2 py-0.5 text-[11px] rounded border transition-colors",
                  helpful === false
                    ? "bg-red-500/10 border-red-500/30 text-red-500"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                No
              </button>
            </div>
          </div>

          {helpful === false && (
            <>
              <select
                value={whyNot}
                onChange={(e) => handleWhyNotChange(e.target.value)}
                className={cn(
                  "w-full text-xs rounded border bg-background px-2 py-1.5",
                  "border-border focus:outline-none focus:ring-1 focus:ring-ring"
                )}
              >
                <option value="">— why not? —</option>
                {WHY_NOT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <textarea
                value={betterQuestion}
                onChange={(e) => setBetterQuestion(e.target.value)}
                onBlur={handleBetterQuestionBlur}
                placeholder="Better question (optional)"
                rows={2}
                className={cn(
                  "w-full text-xs rounded border bg-background px-2 py-1.5 resize-none",
                  "border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                )}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
