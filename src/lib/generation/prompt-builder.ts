import type { AssembledContext } from "./context-assembler";

interface TargetField {
  name: string;
  dataType: string | null;
  isRequired: boolean;
  isKey: boolean;
  description: string | null;
  enumValues: string[] | null;
  sampleValues: string[] | null;
}

interface PromptInput {
  entityName: string;
  entityDescription: string | null;
  targetFields: TargetField[];
  assembledContext: AssembledContext;
}

const SYSTEM_MESSAGE = `You are a data mapping API that outputs ONLY valid JSON. No prose, no markdown, no explanations — just a JSON array.

Your task: given target fields and reference documents, produce a mapping specification for each target field.

OUTPUT FORMAT: A single JSON array. No text before or after. No code fences. Example:

[{"targetFieldName":"field_name","status":"pending","mappingType":"direct","sourceEntityName":"src_table","sourceFieldName":"src_col","transform":null,"defaultValue":null,"enumMapping":null,"reasoning":"Direct 1:1 match on name and type","confidence":"high","notes":null,"reviewComment":null}]

FIELD SCHEMA (every object must have these keys):
- targetFieldName (string): exact target field name from the request
- status (string): "pending" | "unmapped"
- mappingType (string|null): "direct" | "rename" | "type_cast" | "enum" | "flatten_to_normalize" | "aggregate" | "join" | "derived" | "pivot" | "conditional"
- sourceEntityName (string|null): source entity/table name
- sourceFieldName (string|null): source field/column name
- transform (string|null): SQL expression if transformation needed
- defaultValue (string|null): default if no source exists
- enumMapping (object|null): {"source_val": "target_val"} for enum mappings
- reasoning (string): 1-2 sentence explanation
- confidence (string): "high" | "medium" | "low"
- notes (string|null): caveats or open questions
- reviewComment (string|null): REQUIRED when confidence is "medium" or "low". Explain specifically what additional context, documentation, or clarification is needed to make this mapping 100% certain. Be actionable — name the missing info, not just "needs review".

CONFIDENCE CRITERIA:
- high: Clear 1:1 match, well-documented, no ambiguity. Set reviewComment to null.
- medium: Likely correct but assumptions made, or multiple plausible sources. MUST include reviewComment explaining what info would confirm the mapping.
- low: Best guess, significant uncertainty, needs human review. MUST include reviewComment explaining the specific uncertainties and what's needed to resolve them.

RULES:
1. Date fields use YYYY-MM-DD format unless specified otherwise
2. System/audit fields (created_at, updated_at) → status "unmapped" with a note
3. No source field → set sourceEntityName/sourceFieldName to null, suggest defaultValue or confidence "low"
4. EVERY target field in the request MUST have exactly one entry in your response
5. Use exact field names as provided
6. Your entire response must be parseable by JSON.parse() — no trailing commas, no comments, no wrapping text`;

export function buildPrompt(input: PromptInput): { systemMessage: string; userMessage: string } {
  const { entityName, entityDescription, targetFields, assembledContext } = input;

  const parts: string[] = [];

  // Entity header
  parts.push(`# Target Entity: ${entityName}`);
  if (entityDescription) {
    parts.push(`\nDescription: ${entityDescription}`);
  }

  // Target fields
  parts.push(`\n## Target Fields to Map (${targetFields.length} fields)\n`);
  for (const f of targetFields) {
    let line = `- **${f.name}**`;
    const meta: string[] = [];
    if (f.dataType) meta.push(`type: ${f.dataType}`);
    if (f.isRequired) meta.push("required");
    if (f.isKey) meta.push("primary key");
    if (meta.length) line += ` (${meta.join(", ")})`;
    if (f.description) line += ` — ${f.description}`;
    if (f.enumValues?.length) line += `\n  Enum values: ${f.enumValues.join(", ")}`;
    if (f.sampleValues?.length) line += `\n  Sample values: ${f.sampleValues.join(", ")}`;
    parts.push(line);
  }

  // Context sections
  if (assembledContext.primaryContexts.length > 0) {
    parts.push(`\n## Primary Reference Documents\n`);
    for (const c of assembledContext.primaryContexts) {
      parts.push(`### ${c.name}\n\n${c.content}`);
    }
  }

  if (assembledContext.referenceContexts.length > 0) {
    parts.push(`\n## Reference Materials\n`);
    for (const c of assembledContext.referenceContexts) {
      parts.push(`### ${c.name}\n\n${c.content}`);
    }
  }

  if (assembledContext.supplementaryContexts.length > 0) {
    parts.push(`\n## Supplementary Context\n`);
    for (const c of assembledContext.supplementaryContexts) {
      parts.push(`### ${c.name}\n\n${c.content}`);
    }
  }

  // Reinforce JSON-only output at the end of the user message
  parts.push(`\n---\nRespond with ONLY the JSON array for the ${targetFields.length} fields above. No other text.`);

  return {
    systemMessage: SYSTEM_MESSAGE,
    userMessage: parts.join("\n"),
  };
}
