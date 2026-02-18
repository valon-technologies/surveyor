import type { Context } from "@/types/context";
import {
  CONTEXT_TAG_GROUPS,
  CONTEXT_TAG_LABELS,
  type ContextTag,
} from "@/lib/constants";

/** Source-system tags that drive automatic tree grouping. */
const SOURCE_SYSTEM_TAGS = new Set<string>(CONTEXT_TAG_GROUPS.source_system);

export interface ContextTreeNode {
  label: string;
  path: string[];
  fullPath: string;
  children: ContextTreeNode[];
  contexts: Context[];
  totalCount: number;
}

/**
 * Derive a top-level group label from the context's source_system tags.
 * Returns null if the context has no source_system tag or its name
 * already starts with that label (avoiding double-nesting).
 */
function sourceSystemPrefix(ctx: Context): string | null {
  const tags = ctx.tags;
  if (!tags || tags.length === 0) return null;

  const systemTag = tags.find((t) => SOURCE_SYSTEM_TAGS.has(t));
  if (!systemTag) return null;

  const label = CONTEXT_TAG_LABELS[systemTag as ContextTag];
  // Don't double-nest if the name already starts with the label
  const firstName = ctx.name.split(" > ")[0].trim();
  if (firstName.toLowerCase() === label.toLowerCase()) return null;

  return label;
}

/**
 * Build a tree from contexts by splitting names on " > ".
 * e.g. "Federal > CFPB > Escrow" becomes three nested levels.
 *
 * Contexts with a source_system tag are automatically nested under
 * that system's label if their name doesn't already include it.
 */
export function buildContextTree(contexts: Context[]): ContextTreeNode[] {
  const root: ContextTreeNode[] = [];

  for (const ctx of contexts) {
    const prefix = sourceSystemPrefix(ctx);
    const nameSegments = ctx.name.split(" > ").map((s) => s.trim());
    const segments = prefix ? [prefix, ...nameSegments] : nameSegments;
    let currentLevel = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const pathSoFar = segments.slice(0, i + 1);
      const fullPath = pathSoFar.join(" > ");
      const isLeaf = i === segments.length - 1;

      let node = currentLevel.find((n) => n.label === segment);
      if (!node) {
        node = {
          label: segment,
          path: pathSoFar,
          fullPath,
          children: [],
          contexts: [],
          totalCount: 0,
        };
        currentLevel.push(node);
      }

      if (isLeaf) {
        node.contexts.push(ctx);
      }

      currentLevel = node.children;
    }
  }

  // Bubble up totalCount recursively
  function computeCount(nodes: ContextTreeNode[]): number {
    let sum = 0;
    for (const node of nodes) {
      const childCount = computeCount(node.children);
      node.totalCount = node.contexts.length + childCount;
      sum += node.totalCount;
    }
    return sum;
  }
  computeCount(root);

  // Sort nodes alphabetically at each level
  function sortNodes(nodes: ContextTreeNode[]) {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  }
  sortNodes(root);

  return root;
}

/**
 * Filter tree nodes by query string. Returns a pruned copy of the tree
 * containing only nodes whose label or any descendant label matches.
 */
export function searchTree(
  nodes: ContextTreeNode[],
  query: string
): ContextTreeNode[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();

  function matches(node: ContextTreeNode): boolean {
    if (node.label.toLowerCase().includes(q)) return true;
    if (node.contexts.some((c) => c.name.toLowerCase().includes(q))) return true;
    return node.children.some(matches);
  }

  function prune(nodes: ContextTreeNode[]): ContextTreeNode[] {
    const result: ContextTreeNode[] = [];
    for (const node of nodes) {
      if (!matches(node)) continue;
      const prunedChildren = prune(node.children);
      result.push({
        ...node,
        children: prunedChildren,
      });
    }
    return result;
  }

  return prune(nodes);
}

/**
 * Collect all expanded paths needed to show search results.
 */
export function getExpandedPathsForSearch(
  nodes: ContextTreeNode[]
): Set<string> {
  const paths = new Set<string>();
  function walk(nodes: ContextTreeNode[]) {
    for (const node of nodes) {
      if (node.children.length > 0) {
        paths.add(node.fullPath);
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return paths;
}

/**
 * Find a specific node by its fullPath.
 */
export function findNode(
  nodes: ContextTreeNode[],
  fullPath: string
): ContextTreeNode | null {
  for (const node of nodes) {
    if (node.fullPath === fullPath) return node;
    const found = findNode(node.children, fullPath);
    if (found) return found;
  }
  return null;
}
