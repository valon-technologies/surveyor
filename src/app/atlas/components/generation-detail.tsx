"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Bot, Clock, Zap } from "lucide-react";
import {
  buildTermCategoryMap,
  extractTermStrings,
  highlightTermSegments,
  type TermCategory,
} from "../lib/evidence-utils";
import type { Generation } from "@/types/generation";
import type { MappingWithContext } from "@/types/mapping";

export function GenerationDetail({
  generation,
  mapping,
}: {
  generation: Generation;
  mapping: MappingWithContext;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  const prompt = generation.promptSnapshot;
  const totalTokens = (generation.inputTokens || 0) + (generation.outputTokens || 0);

  // Term maps for highlighting
  const termCategoryMap = useMemo(() => buildTermCategoryMap(mapping), [mapping]);

  const promptHighlightMap = useMemo(() => {
    const terms = extractTermStrings(mapping);
    const map = new Map<string, TermCategory | "evidence">();
    for (const t of terms) {
      map.set(t, "evidence");
    }
    return map;
  }, [mapping]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Bot className="h-4 w-4" />
            LLM Reasoning
          </CardTitle>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {generation.provider && (
              <Badge variant="outline" className="text-[10px]">
                {generation.provider}/{generation.model}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Annotated Reasoning */}
        {mapping.reasoning && (
          <div>
            <div className="text-xs font-medium mb-1">Reasoning</div>
            <div className="text-xs text-muted-foreground bg-muted/50 border rounded p-3 whitespace-pre-wrap leading-relaxed">
              <AnnotatedReasoning
                text={mapping.reasoning}
                termCategoryMap={termCategoryMap}
              />
            </div>
          </div>
        )}

        {/* Notes */}
        {mapping.notes && (
          <div>
            <div className="text-xs font-medium mb-1">Notes</div>
            <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded p-3 whitespace-pre-wrap">
              {mapping.notes}
            </div>
          </div>
        )}

        {/* Skills used */}
        {prompt?.skillsUsed && prompt.skillsUsed.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1.5">Skills Used</div>
            <div className="flex flex-wrap gap-1.5">
              {prompt.skillsUsed.map((skill) => (
                <Badge key={skill} variant="secondary" className="text-[10px]">
                  {skill}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Token / duration stats */}
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          {totalTokens > 0 && (
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {generation.inputTokens?.toLocaleString()} in / {generation.outputTokens?.toLocaleString()} out
            </span>
          )}
          {generation.durationMs && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {(generation.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        {/* Collapsible: Full Prompt */}
        {prompt && (
          <CollapsibleSection
            label="Full Prompt"
            isOpen={showPrompt}
            onToggle={() => setShowPrompt(!showPrompt)}
          >
            <div className="space-y-3">
              {prompt.systemMessage && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                    System Message
                  </div>
                  <pre className="text-[11px] bg-muted p-3 rounded overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                    {prompt.systemMessage}
                  </pre>
                </div>
              )}
              {prompt.userMessage && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                    User Message
                  </div>
                  <pre className="text-[11px] bg-muted p-3 rounded overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                    <HighlightedPrompt
                      text={prompt.userMessage}
                      termMap={promptHighlightMap}
                    />
                  </pre>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Collapsible: Raw Response */}
        {generation.output && (
          <CollapsibleSection
            label="Raw LLM Response"
            isOpen={showResponse}
            onToggle={() => setShowResponse(!showResponse)}
          >
            <pre className="text-[11px] bg-muted p-3 rounded overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
              {generation.output}
            </pre>
          </CollapsibleSection>
        )}
      </CardContent>
    </Card>
  );
}

// --- Annotated Reasoning ---

const CATEGORY_STYLES: Record<TermCategory, string> = {
  source: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 rounded-sm px-0.5",
  target: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 rounded-sm px-0.5",
  other: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 rounded-sm px-0.5",
};

function AnnotatedReasoning({
  text,
  termCategoryMap,
}: {
  text: string;
  termCategoryMap: Map<string, TermCategory>;
}) {
  const segments = useMemo(
    () => highlightTermSegments(text, termCategoryMap as Map<string, TermCategory | "evidence">),
    [text, termCategoryMap]
  );

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.category || seg.category === "evidence") {
          return <span key={i}>{seg.text}</span>;
        }
        return (
          <span key={i} className={CATEGORY_STYLES[seg.category]}>
            {seg.text}
          </span>
        );
      })}
    </>
  );
}

// --- Highlighted Prompt ---

function HighlightedPrompt({
  text,
  termMap,
}: {
  text: string;
  termMap: Map<string, TermCategory | "evidence">;
}) {
  const segments = useMemo(
    () => highlightTermSegments(text, termMap),
    [text, termMap]
  );

  return (
    <>
      {segments.map((seg, i) =>
        seg.category ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-800/60 text-inherit rounded-sm px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

// --- Shared Collapsible ---

function CollapsibleSection({
  label,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors text-left"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        {label}
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
