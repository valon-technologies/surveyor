"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useContexts, useContext as useContextDoc } from "@/queries/context-queries";
import { ContextTreePanel } from "./context-tree-panel";
import { ContextContentPanel } from "./context-content-panel";
import { cn } from "@/lib/utils";
import {
  buildContextTree,
  searchTree,
  getExpandedPathsForSearch,
  findNode,
} from "@/lib/context-tree";
import {
  CONTEXT_CATEGORIES,
  CONTEXT_CATEGORY_LABELS,
  type ContextCategory,
} from "@/lib/constants";

interface ContextLibraryProps {
  highlightContextId?: string;
}

export function ContextLibrary({ highlightContextId }: ContextLibraryProps = {}) {
  const [activeCategory, setActiveCategory] = useState<ContextCategory>("foundational");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightApplied, setHighlightApplied] = useState(false);

  // When deep-linking, fetch the target context to know its category
  const { data: highlightContext } = useContextDoc(
    highlightContextId && !highlightApplied ? highlightContextId : undefined
  );

  // Switch category if the highlighted context is in a different one
  useEffect(() => {
    if (highlightContext && !highlightApplied) {
      const cat = highlightContext.category as ContextCategory;
      if (cat && cat !== activeCategory) {
        setActiveCategory(cat);
      }
    }
  }, [highlightContext, highlightApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: contexts, isLoading } = useContexts({ category: activeCategory });

  const fullTree = useMemo(
    () => buildContextTree(contexts || []),
    [contexts]
  );

  // Auto-expand and select the highlighted context when tree is ready
  useEffect(() => {
    if (highlightApplied || !highlightContextId || !contexts?.length || !fullTree.length) return;
    if (highlightContext && highlightContext.category !== activeCategory) return; // waiting for category switch

    // Find the context in current data
    const targetCtx = contexts.find((c) => c.id === highlightContextId);
    if (!targetCtx) return;

    // Build the fullPath for this context (same logic as buildContextTree)
    const segments = targetCtx.name.split(" > ").map((s) => s.trim());
    const fullPath = segments.join(" > ");

    // Expand all ancestor paths
    const pathsToExpand = new Set<string>();
    for (let i = 1; i < segments.length; i++) {
      pathsToExpand.add(segments.slice(0, i).join(" > "));
    }

    setExpandedPaths(pathsToExpand);
    setSelectedPath(fullPath);
    setHighlightApplied(true);
  }, [highlightContextId, contexts, fullTree, highlightApplied, highlightContext, activeCategory]);

  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return fullTree;
    return searchTree(fullTree, searchQuery);
  }, [fullTree, searchQuery]);

  // When searching, auto-expand all matching nodes
  const effectiveExpanded = useMemo(() => {
    if (searchQuery.trim()) {
      return getExpandedPathsForSearch(filteredTree);
    }
    return expandedPaths;
  }, [searchQuery, filteredTree, expandedPaths]);

  const selectedNode = useMemo(() => {
    if (!selectedPath) return null;
    return findNode(filteredTree, selectedPath);
  }, [filteredTree, selectedPath]);

  const handleToggle = useCallback((fullPath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) {
        next.delete(fullPath);
      } else {
        next.add(fullPath);
      }
      return next;
    });
  }, []);

  const handleCategoryChange = (cat: ContextCategory) => {
    setActiveCategory(cat);
    setSelectedPath(null);
    setExpandedPaths(new Set());
    setSearchQuery("");
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      {/* Category tabs */}
      <div className="flex border-b shrink-0">
        {CONTEXT_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2",
              activeCategory === cat
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {CONTEXT_CATEGORY_LABELS[cat]}
            {contexts && activeCategory === cat && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({contexts.length})
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <ContextTreePanel
            nodes={filteredTree}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            expandedPaths={effectiveExpanded}
            onToggle={handleToggle}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
          <ContextContentPanel
            selectedNode={selectedNode}
            totalContextCount={contexts?.length ?? 0}
          />
        </div>
      )}
    </div>
  );
}
