"use client";

import { useState, useMemo, useCallback } from "react";
import { useContexts } from "@/queries/context-queries";
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

export function ContextLibrary() {
  const [activeCategory, setActiveCategory] = useState<ContextCategory>("foundational");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const { data: contexts, isLoading } = useContexts({ category: activeCategory });

  const fullTree = useMemo(
    () => buildContextTree(contexts || []),
    [contexts]
  );

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
