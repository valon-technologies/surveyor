/**
 * Mapping strategy selector — chooses the optimal mapping approach
 * based on scaffold topology, component similarity, and FK dependencies.
 *
 * Strategies:
 * - flat: Single-pass generation for simple entities
 * - assembly-similar: Pattern transfer from primary to similar components
 * - assembly-different: Independent generation for dissimilar components
 * - dependency-aware: Flat generation with FK constraint injection
 */

import type { EntityScaffoldData, SourceTableAnalysis } from "./scaffolding";
import type { FKConstraint } from "./fk-constraint-store";

export type StrategyType =
  | "flat"
  | "assembly-similar"
  | "assembly-different"
  | "dependency-aware";

export interface MappingStrategy {
  type: StrategyType;
  reasoning: string;
  /** For assembly strategies: which component is primary */
  primaryComponent?: string;
  /** For dependency-aware: FK constraints from completed entities */
  fkConstraints?: FKConstraint[];
}

/**
 * Compute Jaccard similarity between two sets of field names.
 */
function jaccardSimilarity(fieldsA: string[], fieldsB: string[]): number {
  const setA = new Set(fieldsA.map((f) => f.toLowerCase()));
  const setB = new Set(fieldsB.map((f) => f.toLowerCase()));

  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Select the optimal mapping strategy for an entity.
 */
export function selectStrategy(
  entityName: string,
  scaffold: EntityScaffoldData | null,
  existingConstraints?: FKConstraint[],
): MappingStrategy {
  // No scaffold — default to flat (or dependency-aware if constraints exist)
  if (!scaffold) {
    if (existingConstraints?.length) {
      return {
        type: "dependency-aware",
        reasoning: `No scaffold available, but FK constraints exist from parent entities. Using flat generation with constraint injection.`,
        fkConstraints: existingConstraints,
      };
    }
    return {
      type: "flat",
      reasoning: "No scaffold available — using default flat generation.",
    };
  }

  const { topology, sourceTables } = scaffold;

  // Single source or multi-source different type → flat (or dependency-aware)
  if (topology === "single_source" || topology === "multi_source_different_type") {
    if (existingConstraints?.length) {
      return {
        type: "dependency-aware",
        reasoning: `${topology} topology with FK constraints from parent entities.`,
        fkConstraints: existingConstraints,
      };
    }
    return {
      type: "flat",
      reasoning: `${topology} topology — straightforward flat mapping.`,
    };
  }

  // Assembly topology — check component similarity
  if (topology === "assembly") {
    const primarySources = sourceTables.filter((s) => s.role === "primary");

    if (primarySources.length < 2) {
      return {
        type: "flat",
        reasoning: "Assembly topology detected but only one primary source — treating as flat.",
      };
    }

    // Check if primary sources have similar field sets (Jaccard > 0.7)
    const firstFields = primarySources[0].matchedFields;
    const allSimilar = primarySources.every((s, i) => {
      if (i === 0) return true;
      // Use matched field counts as proxy for similarity
      const ratio = Math.min(s.matchedFields, firstFields) / Math.max(s.matchedFields, firstFields);
      return ratio > 0.7;
    });

    if (allSimilar) {
      // Find the primary source with highest relevance
      const sorted = [...primarySources].sort((a, b) => b.relevanceScore - a.relevanceScore);
      return {
        type: "assembly-similar",
        reasoning: `Assembly with similar components (similarity > 0.7). Primary component: ${sorted[0].name}. Map primary fully, then delta-only for others.`,
        primaryComponent: sorted[0].name,
        fkConstraints: existingConstraints,
      };
    }

    return {
      type: "assembly-different",
      reasoning: `Assembly with dissimilar components — each component needs independent generation.`,
      fkConstraints: existingConstraints,
    };
  }

  // Multi-source same type — similar to assembly-similar
  if (topology === "multi_source_same_type") {
    const primarySources = sourceTables.filter((s) => s.role === "primary");
    const sorted = [...primarySources].sort((a, b) => b.relevanceScore - a.relevanceScore);

    return {
      type: "assembly-similar",
      reasoning: `Multiple similar source tables. Primary: ${sorted[0]?.name}. Using pattern transfer.`,
      primaryComponent: sorted[0]?.name,
      fkConstraints: existingConstraints,
    };
  }

  // Default
  return {
    type: "flat",
    reasoning: "Default flat strategy.",
    fkConstraints: existingConstraints,
  };
}
