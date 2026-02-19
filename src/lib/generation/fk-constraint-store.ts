/**
 * FK constraint store — in-memory store scoped to a single batch run.
 *
 * After mapping entity A, extract its PK/hash patterns and store them.
 * When mapping entity B that references A, inject A's PK patterns as
 * constraints so the LLM produces consistent FK references.
 */

export interface FKConstraint {
  /** The parent entity that defines this PK */
  entityName: string;
  /** The ID/key field name (e.g., "loan_id") */
  idField: string;
  /** Hash columns used to generate the ID (for hash_id mappings) */
  hashColumns: string[] | null;
  /** The full transform expression */
  transform: string | null;
}

/**
 * In-memory FK constraint store for a batch run.
 */
export class FKConstraintStore {
  private constraints = new Map<string, FKConstraint[]>();

  /**
   * Add constraints from a completed entity.
   */
  addConstraints(entityName: string, constraints: FKConstraint[]): void {
    const existing = this.constraints.get(entityName) ?? [];
    this.constraints.set(entityName, [...existing, ...constraints]);
  }

  /**
   * Get constraints for entities that a target entity depends on.
   * @param dependencyNames - Names of entities this entity depends on
   */
  getConstraintsFor(dependencyNames: string[]): FKConstraint[] {
    const result: FKConstraint[] = [];
    for (const name of dependencyNames) {
      const constraints = this.constraints.get(name);
      if (constraints) {
        result.push(...constraints);
      }
    }
    return result;
  }

  /**
   * Render FK constraints as a prompt section for injection into the LLM prompt.
   */
  renderPromptSection(constraints: FKConstraint[]): string {
    if (constraints.length === 0) return "";

    const parts: string[] = [];
    parts.push(`## Cross-Entity FK Constraints`);
    parts.push(
      `The following parent entities have already been mapped. When this entity ` +
      `references these parent IDs, use the SAME hash pattern for consistency.\n`
    );

    for (const c of constraints) {
      parts.push(`### ${c.entityName}.${c.idField}`);
      if (c.hashColumns?.length) {
        parts.push(`- Hash columns: [${c.hashColumns.join(", ")}]`);
      }
      if (c.transform) {
        parts.push(`- Transform: ${c.transform}`);
      }
      parts.push(
        `- When this entity has a foreign key referencing ${c.entityName}, ` +
        `map it as an identity pass-through from the staging dependency ` +
        `(e.g., source: staging_${c.entityName}.${c.idField}, transform: identity).`
      );
      parts.push("");
    }

    return parts.join("\n");
  }

  /**
   * Get the total number of stored constraints.
   */
  get size(): number {
    let total = 0;
    for (const constraints of this.constraints.values()) {
      total += constraints.length;
    }
    return total;
  }

  /**
   * Check if any constraints exist for a given entity.
   */
  hasConstraintsFor(entityName: string): boolean {
    return (this.constraints.get(entityName)?.length ?? 0) > 0;
  }
}
