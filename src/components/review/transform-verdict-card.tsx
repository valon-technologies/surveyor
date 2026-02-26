"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateMappingVerdict } from "@/queries/mapping-queries";

const TRANSFORM_VERDICT_OPTIONS = [
  { value: "correct", label: "Correct" },
  { value: "not_needed", label: "Transform not needed — map directly" },
  { value: "needed_but_missing", label: "Transform needed but missing" },
  { value: "wrong_enum", label: "Incorrect enum mapping" },
  { value: "wrong_logic", label: "Logic is wrong" },
] as const;

interface TransformVerdictCardProps {
  mappingId: string;
  mappingType: string | null;
  transform: string | null;
  initialVerdict?: string | null;
  initialNotes?: string | null;
}

export function TransformVerdictCard({
  mappingId,
  mappingType,
  transform,
  initialVerdict,
  initialNotes,
}: TransformVerdictCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [verdict, setVerdict] = useState(initialVerdict ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const mutation = useUpdateMappingVerdict();

  const transformLabel = transform
    ? transform.length > 60
      ? transform.slice(0, 60) + "…"
      : transform
    : mappingType || "direct";

  async function save(newVerdict: string, newNotes: string) {
    if (!newVerdict) return;
    setSaveStatus("saving");
    try {
      await mutation.mutateAsync({
        id: mappingId,
        transformVerdict: newVerdict,
        transformVerdictNotes: newNotes || undefined,
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  }

  function handleVerdictChange(value: string) {
    setVerdict(value);
    if (value === "correct" || value === "not_needed") {
      save(value, "");
    }
  }

  function handleNotesBlur() {
    if (verdict && verdict !== "correct") {
      save(verdict, notes);
    }
  }

  const isWrong = verdict && verdict !== "correct";
  const StatusIcon =
    verdict === "correct" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    ) : verdict ? (
      <XCircle className="h-3.5 w-3.5 text-red-400" />
    ) : null;

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
        <span className="flex-1 text-left">Transform Verdict</span>
        {StatusIcon}
        {saveStatus === "saving" && (
          <span className="text-[10px] text-muted-foreground">saving…</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-[10px] text-green-500">saved ✓</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-[11px] text-muted-foreground font-mono bg-muted/50 rounded px-2 py-1 truncate">
            {transformLabel}
          </div>

          <select
            value={verdict}
            onChange={(e) => handleVerdictChange(e.target.value)}
            className={cn(
              "w-full text-xs rounded border bg-background px-2 py-1.5",
              "border-border focus:outline-none focus:ring-1 focus:ring-ring"
            )}
          >
            <option value="">— verdict —</option>
            {TRANSFORM_VERDICT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {isWrong && verdict !== "not_needed" && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Describe what's wrong or what should change"
              rows={2}
              className={cn(
                "w-full text-xs rounded border bg-background px-2 py-1.5 resize-none",
                "border-border focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              )}
            />
          )}
        </div>
      )}
    </div>
  );
}
