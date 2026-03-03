"use client";

import { useState } from "react";
import { useContext as useContextDoc } from "@/queries/context-queries";
import { FileText, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ContextLinkProps {
  contextId: string;
  label?: string;
}

export function ContextLink({ contextId, label }: ContextLinkProps) {
  const [expanded, setExpanded] = useState(false);
  // Only fetch the full context doc when expanded to avoid unnecessary API calls
  const { data: ctx } = useContextDoc(expanded ? contextId : undefined);

  const displayLabel = label || ctx?.name || "Context doc";

  return (
    <span className="inline-flex flex-col">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400",
          "hover:text-blue-800 dark:hover:text-blue-300 hover:underline",
          "text-[inherit] font-medium cursor-pointer",
        )}
        title={ctx?.name || "View context document"}
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span className="truncate max-w-[200px]">{displayLabel}</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
      </button>
      {expanded && ctx && (
        <span className="block mt-1 mb-1 border border-blue-200 dark:border-blue-800 rounded-md bg-blue-50/50 dark:bg-blue-950/20 px-2 py-1.5 text-xs">
          <span className="flex items-center justify-between mb-1">
            <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
              {ctx.name}
            </span>
            <Link
              href={`/context?id=${contextId}`}
              target="_blank"
              className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
            >
              <ExternalLink className="h-3 w-3" />
            </Link>
          </span>
          <span className="block prose prose-xs prose-neutral max-w-none text-xs max-h-48 overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {ctx.content.slice(0, 2000)}
            </ReactMarkdown>
            {ctx.content.length > 2000 && (
              <span className="text-muted-foreground italic">
                ...truncated ({ctx.tokenCount?.toLocaleString()} tokens total)
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

