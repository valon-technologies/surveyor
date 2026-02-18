import type { AssembledContext } from "./context-assembler";

interface ExemplarData {
  targetFieldName: string;
  entityName: string;
  mappingType: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string> | null;
  reasoning: string | null;
  confidence: string | null;
  notes: string | null;
}

interface EditDiff {
  field: string;
  before: string | null;
  after: string | null;
}

interface TargetField {
  name: string;
  dataType: string | null;
  isRequired: boolean;
  isKey: boolean;
  description: string | null;
  enumValues: string[] | null;
  sampleValues: string[] | null;
  currentMapping?: {
    mappingType: string | null;
    sourceEntityName: string | null;
    sourceFieldName: string | null;
    transform: string | null;
    reasoning: string | null;
  };
}

interface RipplePromptInput {
  entityName: string;
  entityDescription: string | null;
  exemplar: ExemplarData;
  editDiffs: EditDiff[];
  userInstruction: string | null;
  targetFields: TargetField[];
  assembledContext: AssembledContext;
}

const RIPPLE_SYSTEM_MESSAGE = `You are a data mapping API that outputs ONLY valid JSON. No prose, no markdown, no explanations — just a JSON array.

A reviewer has just accepted a corrected mapping. Your task: using the accepted mapping as an exemplar, re-derive mappings for the listed target fields. Do NOT blindly copy the exemplar — each field has its own source, type, and semantics. Use the exemplar as guidance for the correction pattern, then apply that pattern thoughtfully to each target field.

OUTPUT FORMAT: A single JSON array. No text before or after. No code fences. Example:

[{"targetFieldName":"field_name","status":"unreviewed","mappingType":"direct","sourceEntityName":"src_table","sourceFieldName":"src_col","transform":null,"defaultValue":null,"enumMapping":null,"reasoning":"Re-derived based on exemplar correction pattern","confidence":"high","notes":null,"reviewComment":null}]

FIELD SCHEMA (every object must have these keys):
- targetFieldName (string): exact target field name from the request
- status (string): "unreviewed" | "unmapped"
- mappingType (string|null): "direct" | "rename" | "type_cast" | "enum" | "flatten_to_normalize" | "aggregate" | "join" | "derived" | "pivot" | "conditional"
- sourceEntityName (string|null): source entity/table name
- sourceFieldName (string|null): source field/column name
- transform (string|null): SQL expression if transformation needed
- defaultValue (string|null): default if no source exists
- enumMapping (object|null): {"source_val": "target_val"} for enum mappings
- reasoning (string): 1-2 sentence explanation referencing the exemplar pattern
- confidence (string): "high" | "medium" | "low"
- notes (string|null): caveats or open questions
- reviewComment (string|null): REQUIRED when confidence is "medium" or "low"

RULES:
1. Use the exemplar's correction as a PATTERN, not a template to copy verbatim
2. If the edit diff shows a source table change, consider whether these fields also need the same source table
3. If the edit diff shows a transform change, apply the same transform logic adapted to each field
4. Maintain each field's own semantics — don't force-fit the exemplar if it doesn't apply
5. If unsure whether the exemplar pattern applies, set confidence "low" with an explanation
6. EVERY target field in the request MUST have exactly one entry in your response
7. Your entire response must be parseable by JSON.parse()`;

export function buildRipplePrompt(input: RipplePromptInput): { systemMessage: string; userMessage: string } {
  const { entityName, entityDescription, exemplar, editDiffs, userInstruction, targetFields, assembledContext } = input;

  const parts: string[] = [];

  // Propagation preamble
  parts.push("# Ripple Edit: Re-derive Mappings from Accepted Correction\n");

  // Exemplar section
  parts.push("## Accepted Exemplar Mapping\n");
  parts.push(`**Entity:** ${exemplar.entityName}`);
  parts.push(`**Target field:** ${exemplar.targetFieldName}`);
  if (exemplar.mappingType) parts.push(`**Mapping type:** ${exemplar.mappingType}`);
  if (exemplar.sourceEntityName) parts.push(`**Source:** ${exemplar.sourceEntityName}.${exemplar.sourceFieldName || "?"}`);
  if (exemplar.transform) parts.push(`**Transform:** \`${exemplar.transform}\``);
  if (exemplar.defaultValue) parts.push(`**Default:** ${exemplar.defaultValue}`);
  if (exemplar.enumMapping) parts.push(`**Enum mapping:** ${JSON.stringify(exemplar.enumMapping)}`);
  if (exemplar.reasoning) parts.push(`**Reasoning:** ${exemplar.reasoning}`);
  if (exemplar.confidence) parts.push(`**Confidence:** ${exemplar.confidence}`);
  if (exemplar.notes) parts.push(`**Notes:** ${exemplar.notes}`);

  // Edit diff section
  if (editDiffs.length > 0) {
    parts.push("\n## What Changed (Edit Diff)\n");
    parts.push("The reviewer made these corrections to the exemplar:\n");
    for (const diff of editDiffs) {
      parts.push(`- **${diff.field}:** \`${diff.before ?? "(empty)"}\` → \`${diff.after ?? "(empty)"}\``);
    }
  }

  // User instruction
  if (userInstruction) {
    parts.push(`\n## Reviewer Instruction\n`);
    parts.push(userInstruction);
  }

  // Target entity header
  parts.push(`\n# Target Entity: ${entityName}`);
  if (entityDescription) {
    parts.push(`\nDescription: ${entityDescription}`);
  }

  // Target fields with current mappings
  parts.push(`\n## Target Fields to Re-derive (${targetFields.length} fields)\n`);
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

    // Show current mapping so LLM knows what exists
    if (f.currentMapping) {
      const cm = f.currentMapping;
      const cmParts: string[] = [];
      if (cm.mappingType) cmParts.push(`type=${cm.mappingType}`);
      if (cm.sourceEntityName) cmParts.push(`source=${cm.sourceEntityName}.${cm.sourceFieldName || "?"}`);
      if (cm.transform) cmParts.push(`transform=\`${cm.transform}\``);
      if (cmParts.length) line += `\n  Current mapping: ${cmParts.join(", ")}`;
      if (cm.reasoning) line += `\n  Current reasoning: ${cm.reasoning}`;
    }

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

  // Reinforce output format
  parts.push(`\n---\nRespond with ONLY the JSON array for the ${targetFields.length} fields above. Use the exemplar correction pattern as guidance. No other text.`);

  return {
    systemMessage: RIPPLE_SYSTEM_MESSAGE,
    userMessage: parts.join("\n"),
  };
}
