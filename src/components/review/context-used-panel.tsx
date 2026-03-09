"use client";

import { useMemo, useState } from "react";
import { useMappingContexts } from "@/queries/mapping-queries";
import { useContext as useContextDoc } from "@/queries/context-queries";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  ExternalLink,
  BookOpen,
  Quote,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { extractCitations } from "@/lib/generation/citation-parser";
import type { MappingContextDetail } from "@/types/mapping";

interface ContextUsedPanelProps {
  mappingId: string;
  /** The mapping's reasoning text — used to identify which contexts were cited */
  reasoning?: string | null;
}

/** Group labels for context types */
const TYPE_LABELS: Record<string, string> = {
  context_reference: "Reference Documents",
  sample_data: "Sample Data",
  qa_answer: "Q&A Answers",
  validation_result: "Validation Results",
  manual_note: "Manual Notes",
};

function groupByType(contexts: MappingContextDetail[]) {
  const groups = new Map<string, MappingContextDetail[]>();
  for (const ctx of contexts) {
    const type = ctx.contextType || "context_reference";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(ctx);
  }
  return groups;
}

export function ContextUsedPanel({ mappingId, reasoning }: ContextUsedPanelProps) {
  const { data: contexts, isLoading } = useMappingContexts(mappingId);
  const [isOpen, setIsOpen] = useState(false);
  const [showOther, setShowOther] = useState(false);

  // Extract cited context IDs from reasoning text
  const citedIds = useMemo(
    () => (reasoning ? extractCitations(reasoning) : new Set<string>()),
    [reasoning]
  );

  // Deduplicate by contextId (a mapping may link to the same doc multiple times)
  const uniqueContexts = useMemo(() => {
    if (!contexts) return [];
    const seen = new Set<string>();
    return contexts.filter((c) => {
      if (!c.contextId || seen.has(c.contextId)) return false;
      seen.add(c.contextId);
      return true;
    });
  }, [contexts]);

  // Split into cited vs uncited groups
  const { cited, uncited } = useMemo(() => {
    if (citedIds.size === 0) {
      // No citations in reasoning — treat all as cited (don't hide anything)
      return { cited: uniqueContexts, uncited: [] as MappingContextDetail[] };
    }
    const c: MappingContextDetail[] = [];
    const u: MappingContextDetail[] = [];
    for (const ctx of uniqueContexts) {
      if (ctx.contextId && citedIds.has(ctx.contextId)) {
        c.push(ctx);
      } else {
        u.push(ctx);
      }
    }
    return { cited: c, uncited: u };
  }, [uniqueContexts, citedIds]);

  if (isLoading) return null;
  if (!contexts || contexts.length === 0) return null;
  if (uniqueContexts.length === 0) return null;

  const hasCitations = citedIds.size > 0;
  const citedGroups = groupByType(cited);
  const uncitedGroups = groupByType(uncited);

  return (
    <div className="border-b bg-muted/10">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/20 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <BookOpen className="h-3.5 w-3.5 text-blue-500 shrink-0" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Context Used
        </span>
        <span className="text-[10px] text-muted-foreground">
          {hasCitations
            ? `(${cited.length} cited, ${uncited.length} other)`
            : `(${uniqueContexts.length} doc${uniqueContexts.length !== 1 ? "s" : ""})`}
        </span>
      </button>

      {isOpen && (
        <div className="px-4 pb-3 space-y-3 max-h-48 overflow-y-auto">
          {/* Cited contexts — always shown when panel is open */}
          {Array.from(citedGroups.entries()).map(([type, items]) => (
            <div key={type}>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {TYPE_LABELS[type] || type}
              </span>
              <div className="mt-1 space-y-1">
                {items.map((item) => (
                  <ContextDocRow
                    key={item.id}
                    item={item}
                    isCited={hasCitations}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Uncited contexts — collapsed by default */}
          {uncited.length > 0 && (
            <div>
              <button
                onClick={() => setShowOther(!showOther)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showOther ? (
                  <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                )}
                <span>
                  Show {uncited.length} more reference document{uncited.length !== 1 ? "s" : ""}
                </span>
              </button>
              {showOther && (
                <div className="mt-2 space-y-3">
                  {Array.from(uncitedGroups.entries()).map(([type, items]) => (
                    <div key={type}>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {TYPE_LABELS[type] || type}
                      </span>
                      <div className="mt-1 space-y-1">
                        {items.map((item) => (
                          <ContextDocRow key={item.id} item={item} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContextDocRow({ item, isCited }: { item: MappingContextDetail; isCited?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { data: fullContext, isError } = useContextDoc(
    expanded ? (item.contextId ?? undefined) : undefined
  );

  return (
    <div className="border border-border/50 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <FileText className="h-3 w-3 text-blue-500 shrink-0" />
        <span className="text-xs font-medium truncate flex-1">
          {item.contextName || "Unknown document"}
        </span>
        {isCited && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-blue-600 dark:text-blue-400 px-1 py-0.5 bg-blue-50 dark:bg-blue-950/50 rounded shrink-0">
            <Quote className="h-2 w-2" />
            Cited
          </span>
        )}
        {item.contextCategory && (
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted/50 rounded">
            {item.contextCategory}
          </span>
        )}
        <Link
          href={`/context?id=${item.contextId}`}
          target="_blank"
          onClick={(e) => e.stopPropagation()}
          className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 shrink-0"
          title="View in Context Library"
        >
          <ExternalLink className="h-3 w-3" />
        </Link>
      </button>

      {expanded && (
        <div className="border-t px-3 py-2 bg-background">
          {isError ? (
            <p className="text-xs text-muted-foreground italic">Context document no longer available</p>
          ) : fullContext ? (
            <div className="max-h-64 overflow-y-auto">
              <article className="prose prose-xs prose-neutral text-xs max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {fullContext.content.slice(0, 3000)}
                </ReactMarkdown>
                {fullContext.content.length > 3000 && (
                  <p className="text-muted-foreground italic text-[10px]">
                    ...truncated ({fullContext.tokenCount?.toLocaleString()} tokens total).{" "}
                    <Link
                      href={`/context?id=${item.contextId}`}
                      target="_blank"
                      className="text-blue-500 hover:underline"
                    >
                      View full document
                    </Link>
                  </p>
                )}
              </article>
            </div>
          ) : item.contextPreview ? (
            <p className="text-xs text-muted-foreground">{item.contextPreview}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">Loading...</p>
          )}
        </div>
      )}
    </div>
  );
}
