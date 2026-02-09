"use client";

import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TreeNode {
  label: string;
  fullPath: string;
  children: TreeNode[];
  totalCount: number;
}

interface TreeViewProps {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (fullPath: string) => void;
  expandedPaths: Set<string>;
  onToggle: (fullPath: string) => void;
  level?: number;
}

export function TreeView({
  nodes,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggle,
  level = 0,
}: TreeViewProps) {
  return (
    <div>
      {nodes.map((node) => {
        const isExpanded = expandedPaths.has(node.fullPath);
        const isSelected = selectedPath === node.fullPath;
        const hasChildren = node.children.length > 0;

        return (
          <div key={node.fullPath}>
            <button
              onClick={() => {
                onSelect(node.fullPath);
                if (hasChildren) onToggle(node.fullPath);
              }}
              className={cn(
                "w-full flex items-center gap-1 py-1 px-2 text-sm rounded transition-colors text-left",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/50 text-foreground/80"
              )}
              style={{ paddingLeft: `${level * 16 + 8}px` }}
            >
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              <span className="truncate flex-1">{node.label}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {node.totalCount}
              </span>
            </button>

            {hasChildren && isExpanded && (
              <TreeView
                nodes={node.children}
                selectedPath={selectedPath}
                onSelect={onSelect}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                level={level + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
