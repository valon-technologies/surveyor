"use client";

import { Search } from "lucide-react";
import { TreeView } from "@/components/ui/tree-view";
import type { ContextTreeNode } from "@/lib/context-tree";

interface ContextTreePanelProps {
  nodes: ContextTreeNode[];
  selectedPath: string | null;
  onSelect: (fullPath: string) => void;
  expandedPaths: Set<string>;
  onToggle: (fullPath: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ContextTreePanel({
  nodes,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggle,
  searchQuery,
  onSearchChange,
}: ContextTreePanelProps) {
  return (
    <div className="w-64 border-r flex flex-col shrink-0">
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search contexts..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            {searchQuery ? "No matches found" : "No contexts yet"}
          </p>
        ) : (
          <TreeView
            nodes={nodes}
            selectedPath={selectedPath}
            onSelect={onSelect}
            expandedPaths={expandedPaths}
            onToggle={onToggle}
          />
        )}
      </div>
    </div>
  );
}
