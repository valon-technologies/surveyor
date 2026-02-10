import type { AssembledContext } from "./context-assembler";

interface FieldMetadata {
  name: string;
  dataType: string | null;
  isRequired: boolean;
  description: string | null;
  enumValues: string[] | null;
}

interface MappingState {
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

interface ChatPromptInput {
  entityName: string;
  entityDescription: string | null;
  targetField: FieldMetadata;
  currentMapping: MappingState | null;
  assembledContext: AssembledContext;
}

const CHAT_SYSTEM_MESSAGE = `You are a senior data mapping expert helping a user review and refine field-level data mappings between a source system and a target schema. You are conversational, precise, and grounded in the reference materials provided.

CAPABILITIES:
- Answer questions about the target field, source data, and mapping logic
- Explain your reasoning for mapping decisions
- Propose alternative mappings if the user disagrees with the current one
- Suggest SQL transform expressions
- Identify ambiguities and help resolve them

MAPPING UPDATES:
When you want to propose a change to the current mapping, include a fenced block in your response:

\`\`\`mapping-update
{
  "mappingType": "direct",
  "sourceEntityName": "table_name",
  "sourceFieldName": "column_name",
  "transform": null,
  "defaultValue": null,
  "enumMapping": null,
  "reasoning": "Updated reasoning",
  "confidence": "high",
  "notes": null
}
\`\`\`

Only include fields you want to change. The user must explicitly accept the update for it to be applied.

RULES:
1. Always reference specific documents, field names, and table names
2. If unsure, say so — never fabricate source field names or mappings
3. Keep responses focused and concise
4. Use the reference materials provided to ground your answers`;

export function buildChatPrompt(input: ChatPromptInput): {
  systemMessage: string;
  contextMessage: string;
} {
  const { entityName, entityDescription, targetField, currentMapping, assembledContext } = input;

  const parts: string[] = [];

  // Field context
  parts.push(`# Current Mapping Context`);
  parts.push(`\n## Target Entity: ${entityName}`);
  if (entityDescription) {
    parts.push(`Description: ${entityDescription}`);
  }

  parts.push(`\n## Target Field: ${targetField.name}`);
  const meta: string[] = [];
  if (targetField.dataType) meta.push(`Type: ${targetField.dataType}`);
  if (targetField.isRequired) meta.push("Required: yes");
  if (meta.length) parts.push(meta.join(" | "));
  if (targetField.description) parts.push(`Description: ${targetField.description}`);
  if (targetField.enumValues?.length) {
    parts.push(`Allowed values: ${targetField.enumValues.join(", ")}`);
  }

  // Current mapping state
  if (currentMapping) {
    parts.push(`\n## Current Mapping`);
    if (currentMapping.mappingType) parts.push(`Type: ${currentMapping.mappingType}`);
    if (currentMapping.sourceEntityName) parts.push(`Source entity: ${currentMapping.sourceEntityName}`);
    if (currentMapping.sourceFieldName) parts.push(`Source field: ${currentMapping.sourceFieldName}`);
    if (currentMapping.transform) parts.push(`Transform: ${currentMapping.transform}`);
    if (currentMapping.defaultValue) parts.push(`Default: ${currentMapping.defaultValue}`);
    if (currentMapping.enumMapping) {
      parts.push(`Enum mapping: ${JSON.stringify(currentMapping.enumMapping)}`);
    }
    if (currentMapping.reasoning) parts.push(`Reasoning: ${currentMapping.reasoning}`);
    if (currentMapping.confidence) parts.push(`Confidence: ${currentMapping.confidence}`);
    if (currentMapping.notes) parts.push(`Notes: ${currentMapping.notes}`);
  } else {
    parts.push(`\n## Current Mapping: None (unmapped)`);
  }

  // Reference materials
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

  return {
    systemMessage: CHAT_SYSTEM_MESSAGE,
    contextMessage: parts.join("\n"),
  };
}
