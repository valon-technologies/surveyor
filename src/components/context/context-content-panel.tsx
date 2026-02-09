"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TagBadge } from "@/components/shared/tag-badge";
import { ChevronRight, ChevronDown, ExternalLink, FileText, FolderOpen } from "lucide-react";
import type { Context } from "@/types/context";
import type { ContextTreeNode } from "@/lib/context-tree";
import {
  CONTEXT_SUBCATEGORY_LABELS,
  type ContextSubcategory,
} from "@/lib/constants";

interface ContextContentPanelProps {
  selectedNode: ContextTreeNode | null;
  totalContextCount: number;
}

export function ContextContentPanel({
  selectedNode,
  totalContextCount,
}: ContextContentPanelProps) {
  // Nothing selected → overview
  if (!selectedNode) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-3 mb-4">
          <FolderOpen className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="font-semibold text-sm">Context Library</h3>
            <p className="text-xs text-muted-foreground">
              {totalContextCount} document{totalContextCount !== 1 ? "s" : ""} total
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Select a node from the tree to browse context documents.
        </p>
      </div>
    );
  }

  const hasChildren = selectedNode.children.length > 0;
  const hasContexts = selectedNode.contexts.length > 0;

  // Leaf node with a single context → show full rendered markdown
  if (!hasChildren && selectedNode.contexts.length === 1) {
    const ctx = selectedNode.contexts[0];

    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold text-base">{selectedNode.label}</h3>
            {ctx.tags && ctx.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {ctx.tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} />
                ))}
              </div>
            )}
          </div>
          <Link href={`/context/${ctx.id}`}>
            <Button size="sm" variant="outline">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          </Link>
        </div>
        <article className="prose prose-sm prose-neutral max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {ctx.content}
          </ReactMarkdown>
        </article>
      </div>
    );
  }

  // Branch node or leaf with multiple contexts
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">{selectedNode.fullPath}</h3>
        <Badge variant="secondary" className="text-[10px]">
          {selectedNode.totalCount}
        </Badge>
      </div>

      {/* Direct contexts at this node */}
      {hasContexts && (
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Documents
          </h4>
          <div className="space-y-2">
            {selectedNode.contexts.map((ctx) => (
              <ExpandableContextCard key={ctx.id} context={ctx} />
            ))}
          </div>
        </div>
      )}

      {/* Child branches — collapsible sections */}
      {hasChildren && (
        <div className="space-y-2">
          {selectedNode.children.map((child) => (
            <CollapsibleGroup key={child.fullPath} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExpandableContextCard({ context: ctx }: { context: Context }) {
  const [expanded, setExpanded] = useState(false);
  const subcategoryLabel = ctx.subcategory
    ? CONTEXT_SUBCATEGORY_LABELS[ctx.subcategory as ContextSubcategory]
    : null;
  const preview = ctx.content.slice(0, 120) + (ctx.content.length > 120 ? "..." : "");

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <h4 className="font-medium text-sm truncate">{ctx.name}</h4>
          </div>
          {!ctx.isActive && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              Inactive
            </Badge>
          )}
        </div>

        {!expanded && (
          <>
            {subcategoryLabel && (
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 ml-5">
                {subcategoryLabel}
              </p>
            )}
            <p className="text-xs text-muted-foreground line-clamp-2 ml-5">{preview}</p>
          </>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t">
          <div className="flex items-center justify-between py-2 mb-2">
            <div className="flex flex-wrap gap-1">
              {ctx.tags?.map((tag) => (
                <TagBadge key={tag} tag={tag} />
              ))}
            </div>
            <Link href={`/context/${ctx.id}`}>
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <ExternalLink className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </Link>
          </div>
          <article className="prose prose-sm prose-neutral max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {ctx.content}
            </ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  );
}

function CollapsibleGroup({ node }: { node: ContextTreeNode }) {
  const [expanded, setExpanded] = useState(false);
  const hasContexts = node.contexts.length > 0;
  const hasChildren = node.children.length > 0;

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors rounded-lg"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm font-medium flex-1">{node.label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {node.totalCount}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Direct contexts */}
          {hasContexts && (
            <div className="space-y-2">
              {node.contexts.map((ctx) => (
                <ExpandableContextCard key={ctx.id} context={ctx} />
              ))}
            </div>
          )}

          {/* Nested children */}
          {hasChildren && (
            <div className="pl-2 space-y-2">
              {node.children.map((child) => (
                <CollapsibleGroup key={child.fullPath} node={child} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
