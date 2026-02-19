/**
 * Dependency graph for entity ordering — ensures entities are mapped in
 * topological order so that FK constraints from parent entities are
 * available when mapping child entities.
 *
 * Scans target fields for *_id suffix patterns and parentEntityId
 * relationships to build a DAG, then topological-sorts it.
 */

import { db } from "@/lib/db";
import { entity, field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface EntityDependency {
  entityId: string;
  entityName: string;
  dependsOn: string[]; // entity names this entity depends on
}

export interface DependencyGraph {
  entities: EntityDependency[];
  sorted: string[]; // entity IDs in topological order (roots first)
  cycles: string[][]; // any detected cycles (should be empty)
}

/**
 * Build a dependency graph from target field FK patterns and entity relationships.
 */
export function buildDependencyGraph(workspaceId: string): DependencyGraph {
  // Load all target entities
  const targetEntities = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    .all();

  const entityNameToId = new Map<string, string>();
  const entityIdToName = new Map<string, string>();
  for (const e of targetEntities) {
    entityNameToId.set(e.name, e.id);
    entityIdToName.set(e.id, e.name);
  }

  // Build dependency set for each entity
  const deps = new Map<string, Set<string>>();
  for (const e of targetEntities) {
    deps.set(e.id, new Set());
  }

  // Strategy 1: parentEntityId relationships
  for (const e of targetEntities) {
    if (e.parentEntityId && deps.has(e.parentEntityId)) {
      deps.get(e.id)!.add(e.parentEntityId);
    }
  }

  // Strategy 2: Scan target fields for *_id patterns that reference other entities
  for (const e of targetEntities) {
    const fields = db
      .select()
      .from(field)
      .where(eq(field.entityId, e.id))
      .all();

    for (const f of fields) {
      // Match patterns like "loan_id", "borrower_id", "property_id"
      const match = f.name.match(/^(.+)_id$/);
      if (!match) continue;

      const refEntityName = match[1]; // e.g., "loan", "borrower"
      const refEntityId = entityNameToId.get(refEntityName);

      // Only add dependency if the referenced entity exists and isn't self
      if (refEntityId && refEntityId !== e.id) {
        deps.get(e.id)!.add(refEntityId);
      }
    }
  }

  // Build EntityDependency list
  const entities: EntityDependency[] = targetEntities.map((e) => ({
    entityId: e.id,
    entityName: e.name,
    dependsOn: Array.from(deps.get(e.id) ?? []).map((id) => entityIdToName.get(id) ?? id),
  }));

  // Topological sort (Kahn's algorithm)
  const { sorted, cycles } = topologicalSort(deps, entityIdToName);

  return { entities, sorted, cycles };
}

/**
 * Kahn's algorithm for topological sort.
 * Returns sorted entity IDs (roots first) and any detected cycles.
 */
export function topologicalSort(
  deps: Map<string, Set<string>>,
  entityIdToName: Map<string, string>,
): { sorted: string[]; cycles: string[][] } {
  // Compute in-degree for each node
  const inDegree = new Map<string, number>();
  for (const id of deps.keys()) {
    inDegree.set(id, 0);
  }
  for (const [, depSet] of deps) {
    for (const dep of depSet) {
      if (inDegree.has(dep)) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      }
    }
  }

  // Wait — in-degree should count how many entities point TO this one.
  // Actually for topological sort, in-degree[v] = number of edges pointing TO v.
  // If entity A depends on entity B, there's an edge B→A (B must come first).
  // So in-degree[A] should count dependencies OF A.

  // Re-compute: in-degree = number of dependencies
  for (const [id, depSet] of deps) {
    inDegree.set(id, depSet.size);
  }

  // Queue starts with nodes that have no dependencies
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  // Build reverse adjacency: for each dependency, which entities depend on it?
  const dependents = new Map<string, string[]>();
  for (const [id, depSet] of deps) {
    for (const dep of depSet) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(id);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);

    // Reduce in-degree of dependents
    const depsOfId = dependents.get(id) ?? [];
    for (const depId of depsOfId) {
      const newDegree = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, newDegree);
      if (newDegree === 0) {
        queue.push(depId);
      }
    }
  }

  // Detect cycles: any node not in sorted is part of a cycle
  const cycles: string[][] = [];
  const sortedSet = new Set(sorted);
  const remaining = [...deps.keys()].filter((id) => !sortedSet.has(id));

  if (remaining.length > 0) {
    // Group remaining into connected components (approximate cycle detection)
    cycles.push(remaining.map((id) => entityIdToName.get(id) ?? id));
    // Add remaining to end of sorted (break cycles arbitrarily)
    sorted.push(...remaining);
  }

  return { sorted, cycles };
}
