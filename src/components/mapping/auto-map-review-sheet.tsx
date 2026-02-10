"use client";

import { useState, useEffect } from "react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Check, X, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useRunGeneration } from "@/queries/generation-queries";
import { useBulkCreateMappings } from "@/queries/mapping-queries";
import { useGenerationQueueStore } from "@/stores/generation-queue-store";
import { useMappingStore } from "@/stores/mapping-store";
import { cn } from "@/lib/utils";
import type { ParsedFieldMapping, ParseResult } from "@/types/generation";
import type { FieldWithMapping } from "@/types/field";
import {
  MAPPING_TYPE_LABELS,
  CONFIDENCE_COLORS,
  LLM_MODELS,
  DEFAULT_MODELS,
  type ConfidenceLevel,
  type MappingType,
} from "@/lib/constants";

type ProviderChoice = "claude" | "openai";

interface AutoMapReviewSheetProps {
  open: boolean;
  onClose: () => void;
  entityId: string;
  entityName: string;
  fields: FieldWithMapping[];
}

type Phase = "pre" | "queued" | "review";

export function AutoMapReviewSheet({
  open,
  onClose,
  entityId,
  entityName,
  fields,
}: AutoMapReviewSheetProps) {
  const [phase, setPhase] = useState<Phase>("pre");
  const [provider, setProvider] = useState<ProviderChoice>("claude");
  const [model, setModel] = useState(DEFAULT_MODELS.claude.batch);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const runGeneration = useRunGeneration();
  const bulkCreate = useBulkCreateMappings();
  const addGeneration = useGenerationQueueStore((s) => s.addGeneration);
  const queue = useGenerationQueueStore((s) => s.queue);
  const reviewGenerationId = useMappingStore((s) => s.reviewGenerationId);
  const setReviewGenerationId = useMappingStore((s) => s.setReviewGenerationId);

  const unmappedFields = fields.filter((f) => !f.mapping || f.mapping.status === "unmapped");
  const unmappedCount = unmappedFields.length;

  // On open: check for a pending review (from queue/toast "Review" click)
  // or find the latest generation for this entity in the queue
  useEffect(() => {
    if (!open || phase !== "pre") return;

    // Check for explicit review request
    if (reviewGenerationId) {
      const item = queue.find((g) => g.generationId === reviewGenerationId);
      if (item) {
        setReviewGenerationId(null);
        if (item.status === "completed" && item.parsedOutput) {
          loadReviewResults(item.parsedOutput, item.generationId);
          return;
        }
        if (item.status === "running") {
          setGenerationId(item.generationId);
          setPhase("queued");
          return;
        }
        // failed: stay on pre phase so they can re-generate
        return;
      }
      setReviewGenerationId(null);
    }

    // Check for any recent generation for this entity in the queue
    const latest = queue.find((g) => g.entityId === entityId);
    if (latest) {
      if (latest.status === "completed" && latest.parsedOutput) {
        loadReviewResults(latest.parsedOutput, latest.generationId);
      } else if (latest.status === "running") {
        setGenerationId(latest.generationId);
        setPhase("queued");
      }
    }
  }, [open]);

  function loadReviewResults(parsedOutput: ParseResult, genId: string) {
    setResult(parsedOutput);
    setGenerationId(genId);
    const highConfidence = new Set<number>();
    parsedOutput.fieldMappings.forEach((m, i) => {
      if (m.confidence === "high") highConfidence.add(i);
    });
    setSelected(highConfidence);
    setExpanded(new Set());
    setPhase("review");
  }

  // Watch for completion of a queued generation started from this sheet
  const queuedItem = generationId
    ? queue.find((g) => g.generationId === generationId)
    : null;

  useEffect(() => {
    if (!queuedItem || phase !== "queued") return;

    if (queuedItem.status === "completed" && queuedItem.parsedOutput) {
      loadReviewResults(queuedItem.parsedOutput, queuedItem.generationId);
    } else if (queuedItem.status === "failed") {
      setPhase("pre");
    }
  }, [queuedItem?.status, queuedItem?.parsedOutput, phase]);

  const handleGenerate = () => {
    runGeneration.mutate(
      {
        entityId,
        generationType: "field_mapping",
        preferredProvider: provider,
        model,
      },
      {
        onSuccess: (data) => {
          setGenerationId(data.generationId);
          addGeneration({
            generationId: data.generationId,
            entityId: data.entityId,
            entityName: data.entityName,
            fieldCount: data.fieldCount,
            provider: data.provider,
            model: data.model,
          });
          setPhase("queued");
        },
        onError: () => {
          setPhase("pre");
        },
      }
    );
  };

  const handleBackToPre = () => {
    setPhase("pre");
    setResult(null);
    setGenerationId(null);
    setSelected(new Set());
    setExpanded(new Set());
  };

  const toggleSelect = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
  };

  const toggleExpanded = (i: number) => {
    const next = new Set(expanded);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setExpanded(next);
  };

  const selectAll = () => {
    if (!result) return;
    setSelected(new Set(result.fieldMappings.map((_, i) => i)));
  };

  const selectHighConfidence = () => {
    if (!result) return;
    const s = new Set<number>();
    result.fieldMappings.forEach((m, i) => {
      if (m.confidence === "high") s.add(i);
    });
    setSelected(s);
  };

  const deselectAll = () => setSelected(new Set());

  const handleSaveSelected = () => {
    if (!result) return;
    const mappings = result.fieldMappings
      .filter((_, i) => selected.has(i))
      .filter((m) => m.targetFieldId)
      .map((m) => ({
        targetFieldId: m.targetFieldId!,
        status: m.status,
        mappingType: m.mappingType || undefined,
        sourceEntityId: m.sourceEntityId || undefined,
        sourceFieldId: m.sourceFieldId || undefined,
        transform: m.transform || undefined,
        defaultValue: m.defaultValue || undefined,
        enumMapping: m.enumMapping || undefined,
        reasoning: m.reasoning || undefined,
        confidence: m.confidence || undefined,
        notes: m.notes || undefined,
        reviewComment: m.reviewComment || undefined,
        createdBy: "llm" as const,
      }));

    bulkCreate.mutate(
      { mappings, generationId: generationId || undefined },
      {
        onSuccess: () => {
          onClose();
          setPhase("pre");
          setResult(null);
          setGenerationId(null);
          setSelected(new Set());
          setExpanded(new Set());
        },
      }
    );
  };

  const handleClose = () => {
    onClose();
    if (phase !== "queued") {
      setPhase("pre");
      setResult(null);
      setGenerationId(null);
      setSelected(new Set());
      setExpanded(new Set());
    }
  };

  return (
    <Sheet open={open} onClose={handleClose} className="w-[560px]">
      <SheetHeader>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Auto-Map: {entityName}
        </h2>
      </SheetHeader>

      <SheetContent>
        {/* Pre-generation */}
        {phase === "pre" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Generate AI mapping suggestions for{" "}
              <span className="font-medium text-foreground">{unmappedCount} unmapped fields</span>.
              The AI will analyze matched skills and context to suggest source fields, transforms, and mapping types.
            </p>

            {/* Provider + model selector */}
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <div className="flex rounded-md border border-purple-200 dark:border-purple-800 overflow-hidden shrink-0">
                  {(["claude", "openai"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setProvider(p);
                        setModel(DEFAULT_MODELS[p].batch);
                      }}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium transition-colors",
                        provider === p
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                          : "text-muted-foreground hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                      )}
                    >
                      {p === "claude" ? "Claude" : "GPT"}
                    </button>
                  ))}
                </div>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="flex-1 rounded-md border border-purple-200 dark:border-purple-800 bg-transparent px-2 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300"
                >
                  {LLM_MODELS[provider].map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              {(() => {
                const selected = LLM_MODELS[provider].find((m) => m.id === model);
                return selected ? (
                  <p className="text-[11px] text-muted-foreground">
                    {(selected.context / 1000).toFixed(0)}K context
                    {selected.costTier === "low" && " · Fast & cheap"}
                    {selected.costTier === "medium" && " · Balanced"}
                    {selected.costTier === "high" && " · Most capable"}
                  </p>
                ) : null;
              })()}
            </div>

            {runGeneration.isError && (
              <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {runGeneration.error?.message || "Generation failed"}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={unmappedCount === 0 || runGeneration.isPending}
              className="relative w-full overflow-hidden rounded-md border border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-500 to-violet-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-purple-600 hover:to-violet-600 hover:shadow-purple-300/40 dark:hover:shadow-purple-900/40 hover:shadow-lg disabled:opacity-50 disabled:pointer-events-none group"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
              <span className="relative flex items-center justify-center gap-2">
                {runGeneration.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Suggestions
                  </>
                )}
              </span>
            </button>

            {unmappedCount === 0 && (
              <p className="text-xs text-muted-foreground text-center">
                All fields already have mappings.
              </p>
            )}
          </div>
        )}

        {/* Queued — generation is running in background */}
        {phase === "queued" && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="relative">
              <Sparkles className="h-8 w-8 text-purple-500" />
              <Loader2 className="h-4 w-4 animate-spin text-purple-400 absolute -bottom-1 -right-1" />
            </div>
            <p className="text-sm font-medium">Generation queued</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              You can close this panel and continue working. The queue indicator in
              the bottom-right corner will show progress, and you&apos;ll be notified
              when results are ready.
            </p>
            <Button variant="outline" size="sm" onClick={handleClose}>
              Close & Continue Working
            </Button>
          </div>
        )}

        {/* Review */}
        {phase === "review" && result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {result.fieldMappings.length} suggestions
                {result.unmappedFields.length > 0 && (
                  <>, {result.unmappedFields.length} unmapped</>
                )}
              </span>
              <button
                onClick={handleBackToPre}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Re-generate
              </button>
            </div>

            {/* Parse errors */}
            {result.parseErrors.length > 0 && (
              <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
                {result.parseErrors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}

            {/* Bulk actions */}
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={selectHighConfidence} className="text-xs">
                Select High Confidence
              </Button>
              <Button size="sm" variant="outline" onClick={selectAll} className="text-xs">
                Select All
              </Button>
              <Button size="sm" variant="outline" onClick={deselectAll} className="text-xs">
                Deselect All
              </Button>
            </div>

            {/* Mapping rows */}
            <div className="space-y-1">
              {result.fieldMappings.map((m, i) => (
                <MappingRow
                  key={i}
                  mapping={m}
                  index={i}
                  isSelected={selected.has(i)}
                  isExpanded={expanded.has(i)}
                  onToggleSelect={() => toggleSelect(i)}
                  onToggleExpand={() => toggleExpanded(i)}
                />
              ))}
            </div>

            {/* Save */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSaveSelected}
                disabled={selected.size === 0 || bulkCreate.isPending}
                className="flex-1"
              >
                {bulkCreate.isPending
                  ? "Saving..."
                  : `Save ${selected.size} Selected`}
              </Button>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MappingRow({
  mapping,
  index,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: {
  mapping: ParsedFieldMapping;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}) {
  const confidenceColor = mapping.confidence
    ? CONFIDENCE_COLORS[mapping.confidence as ConfidenceLevel]
    : "#6b7280";

  return (
    <div
      className={cn(
        "rounded-md border p-2 transition-colors",
        isSelected ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-center gap-2">
        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          className={cn(
            "h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center",
            isSelected
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/30"
          )}
        >
          {isSelected && <Check className="h-3 w-3" />}
        </button>

        {/* Target field */}
        <span className="text-xs font-mono font-medium truncate flex-1">
          {mapping.targetFieldName}
        </span>

        {/* Mapping type badge */}
        {mapping.mappingType && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {MAPPING_TYPE_LABELS[mapping.mappingType as MappingType] || mapping.mappingType}
          </Badge>
        )}

        {/* Confidence dot */}
        <div
          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: confidenceColor }}
          title={mapping.confidence || "unknown"}
        />

        {/* Expand toggle */}
        <button onClick={onToggleExpand} className="p-0.5 hover:bg-muted rounded">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Source preview */}
      {mapping.sourceFieldName && (
        <p className="text-[11px] text-muted-foreground mt-1 pl-6 truncate">
          {mapping.sourceEntityName ? `${mapping.sourceEntityName}.` : ""}
          {mapping.sourceFieldName}
          {mapping.transform ? ` → ${mapping.transform}` : ""}
        </p>
      )}

      {/* Warnings */}
      {mapping.resolveWarnings.length > 0 && (
        <div className="pl-6 mt-1 space-y-0.5">
          {mapping.resolveWarnings.map((w, i) => (
            <p key={i} className="text-[10px] text-yellow-600 dark:text-yellow-400">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Expanded details */}
      {isExpanded && (
        <div className="pl-6 mt-2 space-y-1.5 text-[11px]">
          {mapping.reasoning && (
            <div>
              <span className="font-medium">Reasoning: </span>
              <span className="text-muted-foreground">{mapping.reasoning}</span>
            </div>
          )}
          {mapping.notes && (
            <div>
              <span className="font-medium">Notes: </span>
              <span className="text-muted-foreground">{mapping.notes}</span>
            </div>
          )}
          {mapping.defaultValue && (
            <div>
              <span className="font-medium">Default: </span>
              <span className="text-muted-foreground font-mono">{mapping.defaultValue}</span>
            </div>
          )}
          {mapping.enumMapping && Object.keys(mapping.enumMapping).length > 0 && (
            <div>
              <span className="font-medium">Enum mapping: </span>
              <span className="text-muted-foreground font-mono">
                {Object.entries(mapping.enumMapping)
                  .map(([k, v]) => `${k}→${v}`)
                  .join(", ")}
              </span>
            </div>
          )}
          {mapping.reviewComment && (
            <div className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1.5">
              <span className="font-medium text-amber-700 dark:text-amber-300">Needs clarification: </span>
              <span className="text-amber-600 dark:text-amber-400">{mapping.reviewComment}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
