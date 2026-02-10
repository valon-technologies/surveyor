"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Lightbulb, ChevronDown, ChevronRight } from "lucide-react";
import {
  extractTermStrings,
  parsePromptSections,
  rankSections,
  highlightTermSegments,
  type RankedSection,
  type TermCategory,
} from "../lib/evidence-utils";
import type { MappingWithContext } from "@/types/mapping";
import type { Generation } from "@/types/generation";

const ROLE_COLORS: Record<string, string> = {
  Primary: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Reference: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Supplementary: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300",
  Other: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

const INITIAL_VISIBLE = 3;
const MAX_SNIPPETS_PER_SECTION = 4;

export function EvidencePanel({
  mapping,
  generation,
}: {
  mapping: MappingWithContext;
  generation: Generation;
}) {
  const [expanded, setExpanded] = useState(false);

  const ranked = useMemo(() => {
    const userMessage = generation.promptSnapshot?.userMessage;
    if (!userMessage) return [];

    const terms = extractTermStrings(mapping);
    if (terms.length === 0) return [];

    const sections = parsePromptSections(userMessage);
    return rankSections(sections, terms).slice(0, 8);
  }, [mapping, generation]);

  if (ranked.length === 0) return null;

  const visible = expanded ? ranked : ranked.slice(0, INITIAL_VISIBLE);
  const hasMore = ranked.length > INITIAL_VISIBLE;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Lightbulb className="h-4 w-4" />
          Key Evidence
          <Badge variant="secondary" className="text-[10px] ml-1">
            {ranked.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.map((section, i) => (
          <EvidenceSection key={i} section={section} />
        ))}

        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
          >
            {expanded
              ? "Show less"
              : `Show ${ranked.length - INITIAL_VISIBLE} more...`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceSection({ section }: { section: RankedSection }) {
  const [open, setOpen] = useState(true);
  const snippets = section.snippets.slice(0, MAX_SNIPPETS_PER_SECTION);

  // Build a highlight map for just the evidence terms (all → "evidence")
  const highlightMap = useMemo(() => {
    const map = new Map<string, TermCategory | "evidence">();
    for (const s of snippets) {
      for (const t of s.matchedTerms) {
        map.set(t, "evidence");
      }
    }
    return map;
  }, [snippets]);

  return (
    <div className="border rounded">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted/50 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="font-medium truncate flex-1">{section.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant="outline"
            className={`text-[9px] border-0 ${ROLE_COLORS[section.role] || ROLE_COLORS.Other}`}
          >
            {section.role}
          </Badge>
          <Badge variant="secondary" className="text-[9px]">
            {section.score} terms
          </Badge>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {snippets.map((snippet, i) => (
            <div
              key={i}
              className="bg-muted/50 rounded px-2.5 py-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
            >
              <HighlightedText text={snippet.text} termMap={highlightMap} />
            </div>
          ))}
          {section.snippets.length > MAX_SNIPPETS_PER_SECTION && (
            <div className="text-[10px] text-muted-foreground pl-1">
              +{section.snippets.length - MAX_SNIPPETS_PER_SECTION} more
              snippets
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HighlightedText({
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
