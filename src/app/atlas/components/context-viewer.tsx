"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useContext as useContextDoc } from "@/queries/context-queries";
import { ChevronDown, ChevronRight, FileText, Quote } from "lucide-react";
import {
  CONTEXT_CATEGORY_LABELS,
  type ContextCategory,
} from "@/lib/constants";
import type { MappingContextDetail } from "@/types/mapping";

export function ContextViewer({ contexts }: { contexts: MappingContextDetail[] }) {
  if (contexts.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <FileText className="h-4 w-4" />
          Contexts Used
          <Badge variant="secondary" className="text-[10px] ml-1">
            {contexts.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {contexts.map((ctx) => (
          <ContextItem key={ctx.id} context={ctx} />
        ))}
      </CardContent>
    </Card>
  );
}

function ContextItem({ context }: { context: MappingContextDetail }) {
  const [expanded, setExpanded] = useState(false);
  const { data: fullContext, isLoading } = useContextDoc(
    expanded && context.contextId ? context.contextId : undefined
  );

  const category = context.contextCategory as ContextCategory | null;

  return (
    <div className="border rounded">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="font-medium truncate flex-1">
          {context.contextName || "Unnamed context"}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {category && (
            <Badge variant="outline" className="text-[9px]">
              {CONTEXT_CATEGORY_LABELS[category] || category}
            </Badge>
          )}
          <Badge variant="outline" className="text-[9px]">
            {context.contextType}
          </Badge>
        </div>
      </button>

      {/* Excerpt */}
      {context.excerpt && (
        <div className="px-3 pb-2">
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded p-2">
            <Quote className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
              {context.excerpt}
            </p>
          </div>
        </div>
      )}

      {/* Relevance */}
      {context.relevance && (
        <div className="px-3 pb-2">
          <p className="text-[10px] text-muted-foreground italic">
            {context.relevance}
          </p>
        </div>
      )}

      {/* Full content (expanded) */}
      {expanded && (
        <div className="px-3 pb-3 border-t mt-1 pt-2">
          {isLoading ? (
            <div className="text-[10px] text-muted-foreground animate-pulse py-2">
              Loading full context...
            </div>
          ) : fullContext ? (
            <div className="prose prose-xs max-w-none text-xs max-h-96 overflow-y-auto bg-muted/30 rounded p-3">
              <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed">
                {fullContext.content}
              </pre>
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground py-2">
              Full context not available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
