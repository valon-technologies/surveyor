/**
 * Entity structure classifier — determines whether a target entity needs
 * a component-assembly pattern (UNION ALL) or can be a flat mapping.
 *
 * Prompts the LLM to analyze the source schema for denormalization patterns
 * like repeated field groups (Mortgagor / CoMortgagor prefixes), multiple address types, etc.
 */

import type { LLMProvider } from "@/lib/llm/provider";

interface SourceField {
  name: string;
  dataType: string | null;
}

interface SourceEntity {
  entityName: string;
  fields: SourceField[];
}

export interface ComponentSpec {
  /** Component name (e.g., "borrower_primary") */
  name: string;
  /** Human-readable description of what this component extracts */
  description: string;
  /** Field name prefix pattern to scope source fields (e.g., "Mortgagor*") */
  sourceFieldPattern: string | null;
  /** Filter expression to apply (e.g., "BorrowerIndicator = '05'") */
  filter: string | null;
}

export interface StructureClassification {
  type: "flat" | "assembly";
  /** Only present when type === "assembly" */
  components?: ComponentSpec[];
  /** LLM's reasoning for the classification */
  reasoning: string;
}

const CLASSIFICATION_PROMPT = `You are a data modeling expert. Analyze the target entity and source schema below to determine if the target entity should be mapped as:

1. **flat** — A single mapping file that reads from one or more source tables. Most entities are flat.
2. **assembly** — Multiple component files UNIONed together. This is ONLY needed when the source schema contains denormalized data that must be normalized into separate rows.

SIGNS OF AN ASSEMBLY PATTERN:
- Repeated field groups with prefix patterns (e.g., Mortgagor* and CoMortgagor* fields for borrowers)
- A discriminator/indicator field with multiple values that map to separate target rows (e.g., BorrowerIndicator = '05' for primary, '06' for co-borrower)
- Multiple address types in a single source row (PropertyAddress, MailingAddress) that need to become separate address rows
- Multiple contact types in a single source row (HomePhone, WorkPhone, MobilePhone) that need separate contact rows

SIGNS THIS IS **NOT** AN ASSEMBLY:
- Different source fields map to different target fields (this is just joins, not assembly)
- The target has a 1:1 relationship with the source
- Multiple source tables are needed but each contributes different fields (use joins, not assembly)

OUTPUT FORMAT: Respond with ONLY valid JSON, no prose:
{
  "type": "flat" | "assembly",
  "components": [  // ONLY if type is "assembly"
    {
      "name": "<entity>_<suffix>",
      "description": "What this component extracts",
      "sourceFieldPattern": "Prefix pattern like Mortgagor*",
      "filter": "Discriminator expression if applicable"
    }
  ],
  "reasoning": "1-2 sentence explanation"
}`;

/**
 * Classify whether a target entity needs a component-assembly structure.
 */
export async function classifyStructure(
  entityName: string,
  entityDescription: string | null,
  targetFieldCount: number,
  sourceSchema: SourceEntity[],
  provider: LLMProvider,
  model?: string,
): Promise<StructureClassification> {
  // Build a concise source schema summary
  const schemaSummary = sourceSchema
    .map((se) => {
      const fieldNames = se.fields.map((f) => f.name).join(", ");
      return `### ${se.entityName}\nFields: ${fieldNames}`;
    })
    .join("\n\n");

  const userMessage = `# Target Entity: ${entityName}
${entityDescription ? `Description: ${entityDescription}\n` : ""}Target field count: ${targetFieldCount}

## Source Schema

${schemaSummary}

Classify this entity's structure.`;

  const response = await provider.generateCompletion({
    systemMessage: CLASSIFICATION_PROMPT,
    userMessage,
    model,
    maxTokens: 1024,
    temperature: 0,
  });

  // Parse the JSON response
  try {
    const trimmed = response.content.trim();
    // Handle code fences
    const jsonStr = trimmed.startsWith("{")
      ? trimmed
      : trimmed.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*```/)?.[1] ?? trimmed;

    const parsed = JSON.parse(jsonStr);

    if (parsed.type === "assembly" && Array.isArray(parsed.components)) {
      return {
        type: "assembly",
        components: parsed.components.map((c: Record<string, unknown>) => ({
          name: String(c.name || ""),
          description: String(c.description || ""),
          sourceFieldPattern: c.sourceFieldPattern ? String(c.sourceFieldPattern) : null,
          filter: c.filter ? String(c.filter) : null,
        })),
        reasoning: String(parsed.reasoning || ""),
      };
    }

    return {
      type: "flat",
      reasoning: String(parsed.reasoning || "Flat mapping — no assembly pattern detected"),
    };
  } catch {
    // If parsing fails, default to flat
    return {
      type: "flat",
      reasoning: "Classification parse error — defaulting to flat mapping",
    };
  }
}

/**
 * Known variant-specific prefixes. Fields NOT matching any prefix pattern
 * from any component are considered "shared" (e.g., LoanNumber) and included
 * in every component's scoped schema.
 */
function isVariantField(fieldName: string, allPrefixes: string[]): boolean {
  return allPrefixes.some((prefix) => fieldName.startsWith(prefix));
}

/**
 * Filter source schema to only include fields relevant to a specific component.
 * Keeps fields matching the component's sourceFieldPattern plus shared fields.
 */
export function scopeSourceSchema(
  fullSchema: SourceEntity[],
  component: ComponentSpec,
  allComponents: ComponentSpec[],
): SourceEntity[] {
  if (!component.sourceFieldPattern) return fullSchema;

  const prefix = component.sourceFieldPattern.replace("*", "");
  const allPrefixes = allComponents
    .map((c) => c.sourceFieldPattern?.replace("*", ""))
    .filter((p): p is string => !!p);

  return fullSchema.map((se) => ({
    ...se,
    fields: se.fields.filter(
      (f) =>
        f.name.startsWith(prefix) ||
        !isVariantField(f.name, allPrefixes),
    ),
  })).filter((se) => se.fields.length > 0);
}

/**
 * Generate a mechanical assembly YAML for a set of components.
 * No LLM needed — this is deterministic.
 */
export function generateAssemblyYaml(
  entityName: string,
  components: { name: string; alias: string }[],
  targetColumns: string[],
): string {
  const lines: string[] = [];

  lines.push(`table: ${entityName}`);
  lines.push(`version: 1`);
  lines.push(``);

  // Sources
  lines.push(`sources:`);
  for (const comp of components) {
    lines.push(`  - name: ${comp.name}`);
    lines.push(`    alias: ${comp.alias}`);
    lines.push(`    staging:`);
    lines.push(`      table: "${comp.name}"`);
  }
  lines.push(``);

  // Concat
  lines.push(`concat:`);
  lines.push(`  sources: [${components.map((c) => c.alias).join(", ")}]`);
  lines.push(``);

  // Columns — all identity pass-throughs
  lines.push(`columns:`);
  for (const col of targetColumns) {
    lines.push(`  - target_column: ${col}`);
    lines.push(`    source: ${col}`);
    lines.push(`    transform: identity`);
    lines.push(`    dtype: string`);
  }

  return lines.join("\n");
}
