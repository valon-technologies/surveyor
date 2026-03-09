/**
 * Prompt builder for transfer mapping generation.
 *
 * VDS-first: "For each VDS field in this domain, find the best source
 * from the flat file (if any)."
 */

import { SYSTEM_FIELDS } from "@/lib/transfer/domain-config";

export interface TransferVdsField {
  entity: string;
  field: string;
  dataType: string | null;
  isRequired: boolean;
  description: string | null;
  enumValues: string[] | null;
  foreignKey?: string | null;
}

export interface TransferSourceField {
  position: number;
  fieldName: string;
  sampleValue: string;
  sampleValues?: string[];
}

export interface TransferPromptInput {
  domain: string;
  vdsFields: TransferVdsField[];
  sourceFields: TransferSourceField[];
  skillsText: string;
  learningsText: string;
  correctionsContext: string;
  clientName: string;
  acdcReferenceText?: string;
}

export function buildTransferPrompt(input: TransferPromptInput): {
  systemMessage: string;
  userMessage: string;
  estimatedInputTokens: number;
} {
  const { domain, vdsFields, sourceFields, skillsText, learningsText, correctionsContext, clientName, acdcReferenceText } = input;

  // Group VDS fields by entity
  const byEntity = new Map<string, TransferVdsField[]>();
  for (const f of vdsFields) {
    if (SYSTEM_FIELDS.has(f.field)) continue;
    const existing = byEntity.get(f.entity) || [];
    existing.push(f);
    byEntity.set(f.entity, existing);
  }

  const fieldCount = vdsFields.filter(f => !SYSTEM_FIELDS.has(f.field)).length;

  // Format VDS fields
  const vdsFieldsText = Array.from(byEntity.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entityName, fields]) => {
      const lines = [`### VDS Entity: ${entityName} (${fields.length} fields)`];
      for (const f of fields) {
        const enumNote = f.enumValues?.length ? ` | enums: ${f.enumValues.join(", ")}` : "";
        const fkNote = f.foreignKey ? ` | FK->${f.foreignKey}` : "";
        lines.push(
          `- **${f.field}** (${f.dataType || "unknown"}, ${f.isRequired ? "required" : "optional"}): ${f.description || ""}${enumNote}${fkNote}`
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");

  // Format source fields — show multiple sample values when available
  const sourceText = sourceFields
    .map(f => {
      const samples = f.sampleValues?.length ? f.sampleValues : (f.sampleValue ? [f.sampleValue] : []);
      const sampleNote = samples.length > 1
        ? ` (samples: ${samples.join(" | ")})`
        : samples.length === 1
          ? ` (sample: ${samples[0]})`
          : "";
      return `[${f.position}] ${f.fieldName}${sampleNote}`;
    })
    .join("\n");

  // Corrections section
  const corrSection = correctionsContext
    ? `## Human-Reviewed Corrections (MUST APPLY)\n\nThe following corrections were provided by a human reviewer after examining a prior mapping run.\nYou MUST apply these exactly as stated. Do not override or second-guess these corrections.\n\n${correctionsContext}\n\n`
    : "";

  const systemMessage = `You are a mortgage servicing data migration expert. Your task is to determine which ${clientName} source fields (if any) map to each VDS target field.`;

  const userMessage = `## Context

${clientName} is a flat file with ${sourceFields.length} fields representing a loan-level data extract for servicing transfer. VDS (Valon Data Schema) is a normalized relational schema. You need to find the best ${clientName} source for each VDS field, or determine that no source exists.

## VDS Target Fields — ${domain} domain (${fieldCount} fields)

${vdsFieldsText}

${skillsText ? `## VDS Entity Documentation\n\n${skillsText}\n\n` : ""}## ${clientName} Source Fields (${sourceFields.length} fields — FULL search space)

${sourceText}

${learningsText ? `## Distilled Learnings from Prior Mapping Work\n\n${learningsText}\n\n` : ""}${acdcReferenceText ? `## ACDC Reference Context (for understanding ONLY — NOT valid source fields)\n\nThe following enum maps and lookup tables are from the ACDC source system. Use them to understand field semantics, valid code values, and domain terminology. They help you determine WHICH ${clientName} source field is the correct match and what transformations are needed.\n\n**IMPORTANT: These are NOT valid source fields. Source fields MUST come from the ${clientName} flat file listed above. Never map a VDS field to an ACDC table or field.**\n\n${acdcReferenceText}\n\n` : ""}${corrSection}## Instructions

For **EACH** VDS field listed above (excluding system fields: id, sid, created_at, updated_at, deleted_at, deletion_reason), determine whether any ${clientName} field maps to it.

For each VDS field, output a JSON object with:

1. **vds_entity**: Entity name (snake_case)
2. **vds_field**: Field name
3. **has_mapping**: true if a source field maps to this VDS field, false otherwise
4. **source_field**: Matched source field name (empty string if no mapping)
5. **source_position**: Matched source position as integer (-1 if no mapping)
6. **transformation**: How to transform the value: identity, identity(type), enum_map: {...}, expression: <desc>, or empty string if no mapping
7. **confidence**: HIGH, MEDIUM, or LOW (only when has_mapping=true; empty string when false)
8. **reasoning**: Why this mapping exists, or why no source is available (1-2 sentences)
9. **context_used**: The specific facts you used to make this decision.
10. **follow_up_question**: If has_mapping is false or confidence is LOW/MEDIUM, provide a specific question. If has_mapping is true and confidence is HIGH, use empty string.

## Rules

- **Every non-system VDS field must appear exactly once** in your output.
- Only map a source field if there is a genuine semantic match. Do NOT force mappings.
- Verify that source field names you reference actually exist in the list above.
- A single source field can map to multiple VDS fields.
- Prefer the simplest correct transformation (identity over expression where possible).
- **SYSTEM-GENERATED FK FIELDS**: Fields ending in _id or _sid that are foreign keys to other VDS entities (e.g., loan_id, borrower_id, property_id) are system-generated pass-throughs populated during the VDS staging pipeline. They do NOT come from the source flat file. Set has_mapping to false, reasoning to "System-generated FK — populated as a staging dependency pass-through during VDS pipeline execution, not sourced from flat file." Do NOT search for these in the source fields.
- **REASONING QUALITY**: The reasoning field must provide semantic justification — explain WHY the source field is the correct match based on its meaning, data type, and sample values. Do NOT use lazy reasoning like "Direct 1:1 match on name" or "Field names match". Instead, explain the domain semantics.
- **DEPRECATED FIELDS**: If a target field's description indicates it is deprecated, set has_mapping to false, confidence to "HIGH", and reasoning to "Field deprecated per VDS documentation." Do NOT search for source fields or generate follow-up questions.
- **DATE FROM BOOLEAN**: When the target expects a date/timestamp but the only relevant source is a boolean indicator (Y/N flag), do NOT fabricate a date expression. The boolean tells you IF something happened, not WHEN. Set has_mapping to false and use the follow_up_question to ask where the date value should come from.

## Self-Review Checklist (verify before outputting)

1. Every source field referenced in your output actually exists in the source fields list — no invented names
2. Every non-system VDS field has exactly one entry in your output (count must match)
3. Confidence is calibrated honestly — not everything should be HIGH
4. Sample values were considered when determining the correct mapping

## Output Format

Return a JSON array. No markdown fences, no commentary.

[
  {
    "vds_entity": "loan",
    "vds_field": "loan_number",
    "has_mapping": true,
    "source_field": "Lakeview Loan Number",
    "source_position": 0,
    "transformation": "identity",
    "confidence": "HIGH",
    "reasoning": "Lakeview Loan Number is the servicer's primary loan identifier assigned at boarding, matching VDS loan_number which stores the canonical loan number for all downstream entity references.",
    "context_used": "VDS schema: loan.loan_number (varchar, required); source sample: 123456",
    "follow_up_question": ""
  }
]`;

  // Rough token estimate: ~4 chars per token
  const totalChars = systemMessage.length + userMessage.length;
  const estimatedInputTokens = Math.ceil(totalChars / 3.5);

  return { systemMessage, userMessage, estimatedInputTokens };
}

/**
 * Build a tier-2 prompt for workflow/ops domains (quick triage).
 * These domains almost never have flat-file sources.
 */
export function buildTier2Prompt(input: {
  domains: string[];
  vdsFields: TransferVdsField[];
  sourceFieldNames: string[];
  clientName: string;
}): { systemMessage: string; userMessage: string; estimatedInputTokens: number } {
  const { domains, vdsFields, sourceFieldNames, clientName } = input;

  const byEntity = new Map<string, TransferVdsField[]>();
  for (const f of vdsFields) {
    if (SYSTEM_FIELDS.has(f.field)) continue;
    const existing = byEntity.get(f.entity) || [];
    existing.push(f);
    byEntity.set(f.entity, existing);
  }

  const fieldCount = vdsFields.filter(f => !SYSTEM_FIELDS.has(f.field)).length;

  const vdsText = Array.from(byEntity.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entityName, fields]) => {
      const lines = [`### ${entityName}`];
      for (const f of fields) {
        lines.push(`- ${f.field}: ${f.description || "(no description)"}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const systemMessage = `You are a mortgage servicing data migration expert. The following VDS fields represent workflow, case management, and operational data from these domains: ${domains.join(", ")}.`;

  const userMessage = `${clientName} is a **loan-level flat file** with ${sourceFieldNames.length} fields containing static loan data. It does NOT contain workflow data, case records, task logs, or operational state.

## VDS Fields (${fieldCount} fields)

${vdsText}

## Source Field Names (for reference)

${sourceFieldNames.join(", ")}

## Instructions

For each VDS field, determine if any source field could map to it. For workflow/ops domains, the answer is almost always "no" — but check for any exceptions.

Return JSON array: [{"vds_entity": "...", "vds_field": "...", "has_mapping": false, "source_field": "", "source_position": -1, "transformation": "", "confidence": "", "reasoning": "...", "context_used": "...", "follow_up_question": ""}]`;

  const totalChars = systemMessage.length + userMessage.length;
  return { systemMessage, userMessage, estimatedInputTokens: Math.ceil(totalChars / 3.5) };
}
