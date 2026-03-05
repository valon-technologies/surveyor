/**
 * Dependency graph for entity ordering — ensures entities are mapped in
 * topological order so that FK constraints from parent entities are
 * available when mapping child entities.
 *
 * Two strategies (tried in order):
 * 1. **Production dependencies** — loaded from production-dependencies.json,
 *    imported from the analytics repo's sdt_mapping_config.yaml via
 *    `npx tsx scripts/import-dependency-graph.ts`. This is the authoritative
 *    source used in production Airflow DAGs.
 * 2. **Heuristic fallback** — scans target fields for *_id suffix patterns
 *    and parentEntityId relationships.
 *
 * Strategy 1 is preferred. Strategy 2 kicks in for entities not covered by
 * the production config, or when the JSON file doesn't exist.
 */

import { db } from "@/lib/db";
import { entity, field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export interface EntityDependency {
  entityId: string;
  entityName: string;
  dependsOn: string[]; // entity names this entity depends on
}

export interface DependencyGraph {
  entities: EntityDependency[];
  sorted: string[]; // entity IDs in topological order (roots first)
  cycles: string[][]; // any detected cycles (should be empty)
  source: "production" | "heuristic" | "mixed"; // which strategy was used
}

interface ProductionDependencies {
  version: number;
  source: string;
  importedAt: string;
  entityCount: number;
  dependencies: Record<string, string[]>;
}

/**
 * Try to load production-dependencies.json from the same directory as this file.
 * Returns null if the file doesn't exist or is malformed.
 */
function loadProductionDependencies(): ProductionDependencies | null {
  try {
    // Try multiple resolution strategies for the JSON file
    const candidates: string[] = [];

    // Strategy 1: relative to this file (works in dev with tsx/ts-node)
    try {
      const thisDir = dirname(fileURLToPath(import.meta.url));
      candidates.push(resolve(thisDir, "production-dependencies.json"));
    } catch {
      // import.meta.url may not resolve in all environments
    }

    // Strategy 2: relative to cwd (common in Next.js)
    candidates.push(resolve(process.cwd(), "src/lib/generation/production-dependencies.json"));

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const raw = readFileSync(candidate, "utf-8");
        const parsed = JSON.parse(raw) as ProductionDependencies;
        if (parsed?.dependencies && typeof parsed.dependencies === "object") {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn("[dep-graph] Failed to load production dependencies:", err);
  }
  return null;
}

/**
 * Build a dependency graph. Prefers production dependencies from
 * sdt_mapping_config.yaml when available, falls back to heuristic.
 */
export async function buildDependencyGraph(workspaceId: string): Promise<DependencyGraph> {
  // Load all target entities
  const targetEntities = await db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")))
    ;

  const entityNameToId = new Map<string, string>();
  const entityIdToName = new Map<string, string>();
  for (const e of targetEntities) {
    entityNameToId.set(e.name, e.id);
    entityIdToName.set(e.id, e.name);
  }

  // Build dependency set for each entity (keyed by entity ID)
  const deps = new Map<string, Set<string>>();
  for (const e of targetEntities) {
    deps.set(e.id, new Set());
  }

  // ── Strategy 1: Production dependencies ───────────────────
  const prodDeps = loadProductionDependencies();
  const coveredByProd = new Set<string>(); // entity IDs covered by production config

  if (prodDeps) {
    for (const e of targetEntities) {
      const prodEntry = prodDeps.dependencies[e.name];
      if (prodEntry) {
        coveredByProd.add(e.id);
        for (const depName of prodEntry) {
          const depId = entityNameToId.get(depName);
          if (depId && depId !== e.id) {
            deps.get(e.id)!.add(depId);
          }
        }
      }
    }
  }

  // ── Strategy 2: Heuristic fallback for uncovered entities ─
  const uncoveredEntities = targetEntities.filter((e) => !coveredByProd.has(e.id));

  for (const e of uncoveredEntities) {
    // parentEntityId relationships
    if (e.parentEntityId && deps.has(e.parentEntityId)) {
      deps.get(e.id)!.add(e.parentEntityId);
    }

    // Scan target fields for *_id patterns
    const fields = await db
      .select()
      .from(field)
      .where(eq(field.entityId, e.id))
      ;

    for (const f of fields) {
      const match = f.name.match(/^(.+)_id$/);
      if (!match) continue;

      const refEntityName = match[1];
      const refEntityId = entityNameToId.get(refEntityName);

      if (refEntityId && refEntityId !== e.id) {
        deps.get(e.id)!.add(refEntityId);
      }
    }
  }

  // Determine source label
  let source: DependencyGraph["source"];
  if (!prodDeps || coveredByProd.size === 0) {
    source = "heuristic";
  } else if (uncoveredEntities.length === 0) {
    source = "production";
  } else {
    source = "mixed";
  }

  if (prodDeps) {
    console.log(
      `[dep-graph] Production deps loaded (${coveredByProd.size}/${targetEntities.length} entities covered, source: ${source})`,
    );
  }

  // Build EntityDependency list
  const entities: EntityDependency[] = targetEntities.map((e) => ({
    entityId: e.id,
    entityName: e.name,
    dependsOn: Array.from(deps.get(e.id) ?? []).map((id) => entityIdToName.get(id) ?? id),
  }));

  // Topological sort (Kahn's algorithm)
  const { sorted, cycles } = topologicalSort(deps, entityIdToName);

  return { entities, sorted, cycles, source };
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
