"use client";

import { useState, useEffect, useCallback } from "react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Zap, ChevronRight, CheckCircle2, ArrowLeft } from "lucide-react";
import {
  useRippleSimilar,
  useRippleGenerate,
  useRippleApply,
} from "@/queries/ripple-queries";
import { RippleDiffCard } from "./ripple-diff-card";
import type { ReviewCardData } from "@/types/review";
import type { RippleProposal } from "@/types/ripple";

type PanelPhase = "loading" | "select" | "generating" | "review" | "applying" | "done";

interface RipplePanelProps {
  card: ReviewCardData;
  onClose: () => void;
}

export function RipplePanel({ card, onClose }: RipplePanelProps) {
  const [phase, setPhase] = useState<PanelPhase>("loading");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState("");
  const [proposals, setProposals] = useState<RippleProposal[]>([]);
  const [acceptedProposals, setAcceptedProposals] = useState<Set<number>>(new Set());
  const [generateErrors, setGenerateErrors] = useState<Array<{ entityName: string; error: string }>>([]);
  const [appliedCount, setAppliedCount] = useState(0);

  const { data: similarData, isLoading: similarLoading } = useRippleSimilar(card.id);
  const generateMutation = useRippleGenerate();
  const applyMutation = useRippleApply();

  // Transition from loading to select when data arrives
  useEffect(() => {
    if (!similarLoading && similarData) {
      setPhase("select");
      // Auto-select all similar mappings
      setSelectedIds(new Set(similarData.similar.map((s) => s.mappingId)));
    }
  }, [similarLoading, similarData]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!similarData) return;
    setSelectedIds((prev) => {
      if (prev.size === similarData.similar.length) {
        return new Set();
      }
      return new Set(similarData.similar.map((s) => s.mappingId));
    });
  }, [similarData]);

  const handleGenerate = useCallback(async () => {
    setPhase("generating");
    try {
      const result = await generateMutation.mutateAsync({
        mappingId: card.id,
        targetMappingIds: Array.from(selectedIds),
        userInstruction: instruction || undefined,
      });
      setProposals(result.proposals);
      setGenerateErrors(result.errors);
      // Auto-accept all proposals that have changes
      const autoAccepted = new Set<number>();
      result.proposals.forEach((p, i) => {
        const hasChanges =
          p.before.mappingType !== p.after.mappingType ||
          p.before.sourceEntityName !== p.after.sourceEntityName ||
          p.before.sourceFieldName !== p.after.sourceFieldName ||
          p.before.transform !== p.after.transform ||
          p.before.defaultValue !== p.after.defaultValue ||
          p.before.reasoning !== p.after.reasoning ||
          p.before.confidence !== p.after.confidence;
        if (hasChanges) autoAccepted.add(i);
      });
      setAcceptedProposals(autoAccepted);
      setPhase("review");
    } catch {
      // Error is handled by mutation state
      setPhase("select");
    }
  }, [card.id, selectedIds, instruction, generateMutation]);

  const toggleProposal = useCallback((index: number) => {
    setAcceptedProposals((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleApply = useCallback(async () => {
    const toApply = proposals.filter((_, i) => acceptedProposals.has(i));
    if (toApply.length === 0) return;

    setPhase("applying");
    try {
      const result = await applyMutation.mutateAsync({
        mappingId: card.id,
        proposals: toApply,
      });
      setAppliedCount(result.applied);
      setPhase("done");
    } catch {
      setPhase("review");
    }
  }, [proposals, acceptedProposals, card.id, applyMutation]);

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Ripple Edit</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Propagate corrections from{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            {card.entityName}.{card.targetFieldName}
          </code>
        </p>
      </SheetHeader>

      <SheetContent>
        {/* Loading phase */}
        {phase === "loading" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Finding similar mappings...
            </span>
          </div>
        )}

        {/* Select phase */}
        {phase === "select" && similarData && (
          <div className="space-y-4">
            {similarData.similar.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">
                  No similar mappings found
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This mapping doesn&apos;t share enough signals with other unreviewed mappings
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={onClose}
                >
                  Close
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {similarData.similar.length} similar mapping{similarData.similar.length !== 1 ? "s" : ""} found
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleAll}
                    className="text-xs"
                  >
                    {selectedIds.size === similarData.similar.length
                      ? "Deselect all"
                      : "Select all"}
                  </Button>
                </div>

                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {similarData.similar.map((s) => (
                    <label
                      key={s.mappingId}
                      className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.mappingId)}
                        onChange={() => toggleSelection(s.mappingId)}
                        className="mt-1 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <code className="text-xs font-semibold">
                          {s.entityName}.{s.targetFieldName}
                        </code>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-[10px]">
                            {Math.round(s.score * 100)}% match
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {s.reason}
                          </span>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Optional instruction for re-generation
                  </label>
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="e.g. Use the same source table pattern but check date formatting..."
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm resize-none h-20 bg-background"
                  />
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={selectedIds.size === 0}
                  className="w-full"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Re-generate {selectedIds.size} mapping{selectedIds.size !== 1 ? "s" : ""}
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </>
            )}
          </div>
        )}

        {/* Generating phase */}
        {phase === "generating" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-sm text-muted-foreground">
              Re-deriving {selectedIds.size} mapping{selectedIds.size !== 1 ? "s" : ""}...
            </p>
            <p className="text-xs text-muted-foreground">
              Using the accepted correction as an exemplar
            </p>
          </div>
        )}

        {/* Review phase */}
        {phase === "review" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {proposals.length} proposal{proposals.length !== 1 ? "s" : ""} generated
              </span>
              <span className="text-xs text-muted-foreground">
                {acceptedProposals.size} selected to apply
              </span>
            </div>

            {generateErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs font-medium text-red-700">
                  Errors for some entities:
                </p>
                {generateErrors.map((err, i) => (
                  <p key={i} className="text-xs text-red-600 mt-1">
                    {err.entityName}: {err.error}
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {proposals.map((proposal, index) => (
                <RippleDiffCard
                  key={`${proposal.originalMappingId}-${index}`}
                  entityName={proposal.entityName}
                  targetFieldName={proposal.targetFieldName}
                  before={proposal.before}
                  after={proposal.after}
                  accepted={acceptedProposals.has(index)}
                  onToggle={() => toggleProposal(index)}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPhase("select")}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleApply}
                disabled={acceptedProposals.size === 0}
                className="flex-1"
              >
                Apply {acceptedProposals.size} change{acceptedProposals.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {/* Applying phase */}
        {phase === "applying" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-green-500" />
            <p className="text-sm text-muted-foreground">
              Applying changes...
            </p>
          </div>
        )}

        {/* Done phase */}
        {phase === "done" && (
          <div className="text-center py-8 space-y-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div>
              <p className="text-base font-semibold">
                {appliedCount} mapping{appliedCount !== 1 ? "s" : ""} updated
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                New versions created with ripple attribution
              </p>
            </div>
            <Button onClick={onClose} className="w-full">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to discussion
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
