import type { AssembledContext } from "./context-assembler";
import { getSystemContextBundle, renderSystemContextSection } from "./system-context";
import type { FKConstraint } from "./fk-constraint-store";

interface FieldMetadata {
  name: string;
  dataType: string | null;
  isRequired: boolean;
  isKey?: boolean;
  description: string | null;
  enumValues: string[] | null;
}

interface MappingState {
  mappingType: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string | null> | null;
  reasoning: string | null;
  confidence: string | null;
  notes: string | null;
}

interface SourceEntitySchema {
  entityName: string;
  fields: { name: string; dataType: string | null; description?: string | null }[];
}

export interface SourceDataPreview {
  tableName: string;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  fieldProfile?: {
    fieldName: string;
    distinctValues?: unknown[];
    nullCount?: number;
    totalRows?: number;
  };
}

interface SiblingFieldSummary {
  name: string;
  dataType: string | null;
  mappingStatus: string; // "mapped (high)", "mapped (medium)", "unmapped", etc.
  sourceInfo: string | null; // "Transaction.TotalAmountPaid" or null
  mappingType: string | null;
  transform: string | null;
  reasoning: string | null;
  confidence: string | null;
}

interface EntityLearning {
  fieldName: string;
  correction: string;
}

interface CrossEntityLearning {
  entityName: string;
  entityDescription: string | null;
  fieldName: string;
  correction: string;
}

interface EntityStructure {
  structureType: "flat" | "assembly";
  sources: { name: string; alias: string; table: string }[];
  joins?: { left: string; right: string; on: string[]; how: string }[] | null;
  hasConcat: boolean;
}

interface SourceSchemaStats {
  tableCount: number;
  fieldCount: number;
  primarySource?: string;
}

interface AnsweredQuestion {
  question: string;
  answer: string;
  fieldName: string | null;
}

interface ChatPromptInput {
  entityName: string;
  entityDescription: string | null;
  targetField: FieldMetadata;
  currentMapping: MappingState | null;
  assembledContext: AssembledContext;
  sourceSchema?: SourceEntitySchema[];
  sourceDataPreview?: SourceDataPreview | null;
  priorDiscussionSummary?: string;
  entityLearnings?: EntityLearning[];
  crossEntityLearnings?: CrossEntityLearning[];
  siblingFields?: SiblingFieldSummary[];
  bigqueryAvailable?: boolean;
  bigqueryDataset?: string;
  baselineDataPreloaded?: boolean;
  entityStructure?: EntityStructure;
  pipelineYamlSpec?: string;
  ragEnabled?: boolean;
  sourceSchemaStats?: SourceSchemaStats;
  unmatchedPipelineSources?: string[];
  answeredQuestions?: AnsweredQuestion[];
  workspaceRules?: string[];
  workspaceId?: string;
  scaffoldStrategy?: string;
  fkConstraints?: FKConstraint[];
}

const CHAT_SYSTEM_MESSAGE = `You are a senior data mapping expert helping a user review and refine field-level data mappings between a source system and a target schema. You are conversational, precise, and grounded in the reference materials provided.

CAPABILITIES:
- Answer questions about the target field, source data, and mapping logic
- Explain your reasoning for mapping decisions
- Propose alternative mappings if the user disagrees with the current one
- Suggest SQL transform expressions
- Identify ambiguities and help resolve them
- Reference actual source data samples when provided to ground your recommendations

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
  "notes": null,
  "question": null
}
\`\`\`

The "question" field should contain a structured follow-up question for the client (e.g. ServiceMac) when you need information to finalize the mapping. For example: "Which FcStopCode value represents 'judgement entered'?" Set to null when no question is needed. Questions should be specific, actionable, and answerable by someone who knows the source system.

VALID VALUES (use ONLY these exact strings):
- mappingType: "direct" | "rename" | "type_cast" | "enum" | "flatten_to_normalize" | "aggregate" | "join" | "derived" | "pivot" | "conditional"
- confidence: "high" | "medium" | "low"

Only include fields you want to change. The user must explicitly accept the update for it to be applied.

SIBLING FIELD AWARENESS:
The context includes other fields in this entity and their current mappings. USE THIS to inform your approach:
- If most sibling fields already map to the same source entity (e.g. Transaction), assume the current field likely maps there too unless there's a clear reason not to.
- Look for obvious name matches between the target field and source fields in the established source entity. If there's a strong candidate (e.g. target "effective_date" and source has "EffectiveDate"), propose it directly with your reasoning rather than asking the user to confirm the obvious.
- Only explore alternative source entities if the established source clearly doesn't have a matching field, or if the field's semantics clearly point elsewhere.

ENTITY STRUCTURAL PATTERNS:
When sibling mappings include transforms and reasoning, examine them for consistent structural approaches:
- If siblings use UNION ALL patterns, this field likely needs the same structure with a different column.
- If siblings use CASE/conditional logic, this field may need a parallel CASE expression.
- Maintain grain consistency: if siblings establish a row-level grain, your mapping should produce the same grain.
- When proposing a transform, reference the sibling pattern you're following and explain differences.

CONVERSATION OPENING:
When the conversation begins:
1. Check sibling field mappings to understand the established source pattern AND structural approach for this entity.
2. If there's an obvious mapping candidate based on sibling patterns + field name/type matching, PROPOSE IT immediately with a mapping-update block. Explain your reasoning briefly and ask the user to confirm or push back.
3. Only ask questions when there's genuine ambiguity — e.g. multiple plausible source fields, unclear transform logic, or no obvious candidate. Even then, limit to 1-2 focused questions maximum.
4. Never ask questions you can answer from the context (source schema, sibling mappings, reference docs). Be opinionated — propose first, adjust if the user disagrees.
5. Keep the opening short and action-oriented. Lead with your recommendation, not a list of questions.

CITATIONS: When referencing a document from the context, include its [ref:...] tag so reviewers can trace your reasoning back to the source material. Example: "Per [ref:ctx_abc123], the source should be DefaultWorkstations."

FORMATTING:
- Do NOT use emojis in your responses. Use plain text markers instead:
  - For corrections/changes: use "(!)" prefix (e.g. "(!) Corrected source table: X")
  - For blocked/pending items: use "(X)" prefix (e.g. "(X) Blocked on: need FcStopCode value")
  - For confirmed items: use plain text, no marker needed

RULES:
1. Always reference specific documents, field names, and table names
2. Prefer source field names from the "Available Source Schema" section, but be aware that schema documentation may be incomplete — fields can exist in actual data tables that aren't documented. If you suspect a field should exist based on naming conventions or domain knowledge, use a BigQuery query to verify before proposing it. Never fabricate field names, but DO explore the actual data when the schema seems insufficient for the mapping.
3. Keep responses focused and concise — aim for short, decisive responses
4. Use the reference materials provided to ground your answers
5. Build on insights from prior discussions when available — don't repeat questions that were already answered
6. If you notice your mapping logic applies to other fields in this entity, mention it — the user can propagate your approach to related fields
7. NEVER list remaining unmapped fields, suggest "next steps", or offer a menu of what to do next after concluding a mapping. The UI provides navigation buttons for that. After a mapping is confirmed, simply acknowledge it concisely and stop.
8. Be opinionated and propose-first. The user wants decisive recommendations, not interrogation. A wrong proposal that gets corrected in one turn is better than 3 rounds of questions.

RECEIVING EXPERT FEEDBACK:
When the user provides domain-specific corrections or guidance:
- Treat their corrections as authoritative — they have deep knowledge of this data and its real-world behavior.
- When corrected, revise your proposal and submit a mapping-update block immediately. Do not debate or ask for confirmation of the correction.
- Internalize corrections for the rest of this conversation — do not repeat the same mistake on a subsequent turn.
- If they point you toward a specific source field or approach, investigate it seriously (query BigQuery if needed) and propose based on what you find.
- Review any "Prior Discussion History" carefully before proposing — if a prior session already corrected a specific mistake, do not make that mistake again.

MAPPING CONVENTIONS:
These principles apply to ALL mappings in this workspace. Follow them unless context explicitly contradicts.

1. PREFER SIMPLICITY — IDENTITY FIRST:
   Many fields map directly from a single source column with \`transform: identity\`. Before writing complex logic, check if the source column already contains the correct data. A direct identity mapping that works is always better than a clever expression that might break.

2. BOOLEAN FIELDS — NEVER USE CAST:
   Source systems store booleans as indicator codes, NOT native booleans. Convert using equality/membership checks:
   - Single indicator: \`source_field = 'Y'\` or \`source_field = '1'\`
   - Code list: \`source_field IN ('A', 'H')\`
   - NEVER use \`CAST(x AS BOOL)\` or \`IF(x, true, false)\` on string indicator fields
   - When the source indicator is undocumented or absent, map as null (not false)

3. ENUM FIELDS — COMPLETENESS REQUIRED:
   Source systems use cryptic short codes. Map them with CASE WHEN:
   - Example: GSE codes 'F' → 'FANNIE', 'H' → 'FREDDIE', 'G' → 'GINNIE'
   - COUNT the target field's allowed enum values. Your CASE WHEN MUST produce ALL target values plus an ELSE NULL
   - If target has 5 enum values, you need 5 output branches. Before submitting, verify: (a) every target enum value appears in your CASE output, (b) every known source code is handled, (c) ELSE clause exists for unknown codes
   - If the source column already contains the target enum values, use identity

4. DATE FIELDS — RESPECT SOURCE FORMAT:
   - If the source column is already a date/datetime type, use identity
   - Conditional dates (only valid when a status applies): use CASE WHEN to return the date only when the condition holds, else NULL
   - Do NOT apply date parsing (PARSE_DATE, FORMAT_DATE) unless the source is a string that needs conversion — verify the actual data type first

5. NULL HANDLING — LESS IS MORE:
   - Do NOT add COALESCE, IFNULL, or CASE WHEN null checks unless the target field is REQUIRED and the source is nullable
   - For OPTIONAL target fields: let NULLs flow through naturally. Do not invent default values.
   - For REQUIRED target fields: use COALESCE with a sensible domain-appropriate default
   - If a field has no available source data at all, map it as unmapped/not_applicable — do NOT fabricate a mapping

6. SOURCE COLUMN SELECTION:
   - Source tables have CamelCase columns (e.g., LoanNumber, InvestorLoanNumber, GseCode). Target fields use snake_case. Don't expect exact name matches — look for semantic matches.
   - Each source table has a domain: know which table likely contains which type of data. Check the schema before guessing.
   - When a field needs data from a joined table (not the primary source), use the correct join alias from the entity's declared dependencies.

7. ID AND KEY FIELDS:
   - Primary key fields (e.g., loan_id, borrower_id) use deterministic hashing: SHA256 hash of sorted natural key values joined with underscores, prefixed with PROJECT_entity_name. Set mappingType to "hash_id" for PKs.
   - Foreign key references (e.g., prior_servicer_id, mbs_pool_id) are pass-through identity columns from staging table joins — they are NOT re-derived. If an ID field's target name ends with '_id' and matches a parent entity name, map as identity from the staging dependency (e.g., loan_id comes from staging:loan.loan_id). Set mappingType to "direct" for FK pass-throughs.
   - Check the entity's declared joins/dependencies for the correct alias and ID column.
   - If an ID field has no clear source, map as unmapped rather than guessing.

8. UNMAPPABLE FIELDS:
   Some fields genuinely have no source data available. Indicators: the source tables have no semantically matching column, BigQuery queries confirm no relevant data exists, or prior sessions concluded the field is unmappable. In these cases, map as not_applicable — do not force a bad mapping.

9. REFERENCE ENTITY DETECTION — WHEN TARGET FIELDS DESCRIBE ANOTHER ENTITY:
   Sometimes target fields describe attributes of a different entity, not the primary source. The trigger is NOT seeing a FK column — it's recognizing a CLUSTER of target fields that belong to a separate domain object.

   WHEN TO APPLY:
   - Look at sibling target fields. If you see a group like court_district, court_state, court_division — these are all attributes OF a court, not the loan itself.
   - Similarly: trustee_name, trustee_email, trustee_phone → attributes of a trustee/party.
   - This does NOT apply to ID/key/number fields. If the target asks for a court_id, ginnie_pool_number, or similar identifier, a direct FK pass-through is the correct mapping. Only activate this workflow when the target field is a descriptive attribute (name, state, date, type, etc.) that semantically belongs to another entity.

   WORKFLOW (when you detect an attribute cluster):
   a. RECOGNIZE THE PATTERN: "These N fields all describe a {entity_type} — I need a reference table for {entity_type}, not fabricated columns on the primary source."
   b. FIND THE FK: Look for a FK column in the primary source that links to the reference entity (e.g., BankruptcyCourtId in DefaultWorkstations → links to Courts).
   c. SEARCH FOR THE REFERENCE TABLE: Use search_source_schema (RAG mode) or check Available Source Schema for a matching table (e.g., "Courts", "Court", "Party").
   d. IF FOUND: Join through the FK to get attribute fields from the reference table. The reference table's columns ARE the source — not fabricated columns on the FK table.
   e. IF NOT FOUND: Use query_bigquery to check if the table exists in the dataset (e.g., SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE table_name LIKE '%Court%').
   f. IF TABLE EXISTS IN BQ BUT NOT IN SCHEMA: Flag this in your response: "CONTEXT GAP: Fields {field_list} describe a '{entity_type}' entity. The source table has FK column '{fk_column}' but no '{table}' reference table is available in the source schema. A human should add this table as a source entity for accurate mapping." Map these fields as unmapped/requires_context rather than guessing.
   g. NEVER fabricate attribute columns on the FK table. If DefaultWorkstations has BankruptcyCourtId, it does NOT have BankruptcyCourtState — that lives on Courts.`;

/**
 * Hard-coded domain rules from battle-tested mapping experience.
 * These prevent recurring errors observed across many mapping sessions.
 */
export const DOMAIN_RULES = [
  `ACDC DATE FORMAT: ACDC dates are already YYYY-MM-DD strings. Use SAFE_CAST(x AS DATE), NEVER PARSE_DATE. PARSE_DATE will silently NULL out valid dates if the format doesn't match exactly.`,
  `ENTITY BOUNDARIES: These fields belong to loan_at_origination_info, NOT loan: original_interest_rate, original_loan_amount, original_loan_term, original_ltv_ratio, original_cltv_ratio, original_dti_ratio, original_upb. Also: principal_balance belongs to loan_accounting_balance, NOT loan.`,
  `EXHAUSTIVE FIELD SEARCH: Before mapping any field, search ALL tables via INFORMATION_SCHEMA. Compare null rates + distinct values across candidates. Do NOT stop at the first table that has a matching column name — there may be a better source with higher population rates or more accurate data.`,
  `CONDITIONAL LOGIC FOR PREFIXED FIELDS: Fields prefixed with hamp_*, fannie_*, ginnie_*, fha_*, va_* MUST include investor/program type filtering in their transform. A ginnie_ field should only be populated when the loan is a Ginnie Mae loan. Do NOT return values for loans that don't match the prefix's program.`,
  `FUTURE-PROOF NULL FIELDS: If a target field is schema-active and semantically relevant but the source column is currently 0% populated, still map it. Use the correct source column even if all values are NULL today — data may appear later. Only use transform: null (unmapped) when no plausible source column exists at all.`,
  `BIGQUERY TYPES ARE ARTIFACTS: INT64/STRING types in BigQuery may not reflect the true schema. A column typed STRING may contain dates, enums, or booleans stored as text codes. Always check the Ocean ACDC Schema Lookups (enum reference docs) before assuming a column's semantic type from its BigQuery data type.`,
  `PRE-FLIGHT ENUM CHECKLIST: Before mapping ANY enum field: (1) query source distinct values via BigQuery, (2) compare against target allowed values from the field definition, (3) document gaps between source codes and target enum values. Never assume source codes match target values without checking.`,
];

/**
 * Render domain rules + workspace rules as a system message section.
 */
export function renderWorkspaceRulesSection(workspaceRules?: string[]): string {
  const parts: string[] = [];

  parts.push(`\nDOMAIN-SPECIFIC RULES (from battle-tested mapping experience — follow these strictly):`);
  for (let i = 0; i < DOMAIN_RULES.length; i++) {
    parts.push(`${i + 1}. ${DOMAIN_RULES[i]}`);
  }

  if (workspaceRules && workspaceRules.length > 0) {
    parts.push(`\nWORKSPACE RULES (learned from corrections in this workspace — follow these strictly):`);
    const capped = workspaceRules.slice(0, 20);
    for (let i = 0; i < capped.length; i++) {
      parts.push(`${i + 1}. ${capped[i]}`);
    }
  }

  return parts.join("\n");
}

/**
 * Render a SourceDataPreview as markdown for prompt injection.
 */
export function renderSourceDataPreview(preview: SourceDataPreview): string {
  const parts: string[] = [];
  parts.push(`\n## Source Data Preview (from BigQuery)`);
  parts.push(`Table: ${preview.tableName} (${preview.rowCount.toLocaleString()} total rows)\n`);

  if (preview.sampleRows.length > 0) {
    const cols = Object.keys(preview.sampleRows[0]);
    parts.push(`| ${cols.join(" | ")} |`);
    parts.push(`| ${cols.map(() => "---").join(" | ")} |`);
    for (const row of preview.sampleRows) {
      const vals = cols.map((c) => {
        const v = row[c];
        return v === null ? "NULL" : String(v);
      });
      parts.push(`| ${vals.join(" | ")} |`);
    }
  }

  if (preview.fieldProfile) {
    const fp = preview.fieldProfile;
    parts.push(`\n### Field Profile: ${fp.fieldName}`);
    if (fp.nullCount != null && fp.totalRows != null) {
      const nullPct = ((fp.nullCount / fp.totalRows) * 100).toFixed(1);
      parts.push(`- Null rate: ${fp.nullCount}/${fp.totalRows} (${nullPct}%)`);
    }
    if (fp.distinctValues && fp.distinctValues.length > 0) {
      const vals = fp.distinctValues.map((v) => v === null ? "NULL" : `\`${v}\``);
      parts.push(`- Sample distinct values: ${vals.join(", ")}`);
    }
  }

  parts.push("");
  return parts.join("\n");
}

/**
 * Inject pre-fetched baseline BQ data into an existing context message.
 * Splices the rendered section before "## Prior Discussion History" if present,
 * otherwise appends before "## Primary Reference Documents".
 */
export function injectBaselineData(
  existingContextMessage: string,
  baseline: SourceDataPreview
): string {
  const rendered = renderSourceDataPreview(baseline);

  // Try to insert before Prior Discussion History
  const priorIdx = existingContextMessage.indexOf("\n## Prior Discussion History");
  if (priorIdx !== -1) {
    return existingContextMessage.slice(0, priorIdx) + rendered + existingContextMessage.slice(priorIdx);
  }

  // Try to insert before Primary Reference Documents
  const refIdx = existingContextMessage.indexOf("\n## Primary Reference Documents");
  if (refIdx !== -1) {
    return existingContextMessage.slice(0, refIdx) + rendered + existingContextMessage.slice(refIdx);
  }

  // Try before Reference Materials
  const refMatIdx = existingContextMessage.indexOf("\n## Reference Materials");
  if (refMatIdx !== -1) {
    return existingContextMessage.slice(0, refMatIdx) + rendered + existingContextMessage.slice(refMatIdx);
  }

  // Fallback: append
  return existingContextMessage + "\n" + rendered;
}

export async function buildChatPrompt(input: ChatPromptInput): Promise<{
  systemMessage: string;
  contextMessage: string;
}> {
  const { entityName, entityDescription, targetField, currentMapping, assembledContext, sourceSchema, sourceDataPreview, priorDiscussionSummary, entityLearnings, crossEntityLearnings, siblingFields, bigqueryAvailable, bigqueryDataset, baselineDataPreloaded, entityStructure, ragEnabled, sourceSchemaStats } = input;

  const parts: string[] = [];

  // Field context
  parts.push(`# Current Mapping Context`);
  parts.push(`\n## Target Entity: ${entityName}`);
  if (entityDescription) {
    parts.push(`Description: ${entityDescription}`);
  }

  // Entity architecture — helps the agent understand structure before mapping individual fields
  if (entityStructure) {
    if (entityStructure.structureType === "assembly") {
      parts.push(`\n## Entity Architecture: ASSEMBLY`);
      parts.push(
        `**This is an assembly entity.** It does NOT read directly from raw source tables. ` +
        `Instead, it reads from staging components (listed below) that perform the actual ` +
        `source-to-staging transforms. The assembly layer routes and combines component outputs.\n`
      );
      parts.push(`**How to map fields in this entity:**`);
      parts.push(`1. **Pass-through fields**: Most fields are identity pass-throughs from a component. ` +
        `Map as: source = \`{component_alias}.{field_name}\`, transform = identity.`);
      parts.push(`2. **Component-level transforms**: The real source field and transform logic live in the component, ` +
        `NOT the assembly. When documenting the mapping, reference the ACDC source field that the component uses.`);
      parts.push(`3. **Assembly-only fields**: Fields that combine data across components or add derived logic ` +
        `belong at the assembly level with their own transforms.\n`);

      parts.push(`**Dependencies (staging components):**`);
      for (const src of entityStructure.sources) {
        parts.push(`- \`${src.alias}\` → reads from \`${src.table}\` (component: ${src.name})`);
      }

      if (entityStructure.joins?.length) {
        parts.push(`\n**Joins between components:**`);
        for (const j of entityStructure.joins) {
          parts.push(`- ${j.left} ${j.how.toUpperCase()} JOIN ${j.right} ON ${j.on.join(", ")}`);
        }
      }

      if (entityStructure.hasConcat) {
        parts.push(`\n**UNION/CONCAT**: This assembly concatenates (UNIONs) multiple component outputs into one table. ` +
          `Each component produces rows for a subset of the data (e.g., primary vs co-borrower).`);
      }
    } else {
      // Flat entity — brief note
      parts.push(`\n## Entity Architecture: FLAT`);
      parts.push(
        `This entity maps directly from source tables — no staging components or assembly layer.\n`
      );
      if (entityStructure.sources.length > 0) {
        parts.push(`**Sources:**`);
        for (const src of entityStructure.sources) {
          parts.push(`- \`${src.alias}\` → \`${src.table}\``);
        }
      }
    }
  }

  // Scaffold strategy (from Phase 2 scaffolding engine)
  if (input.scaffoldStrategy) {
    parts.push(`\n## Mapping Strategy\n${input.scaffoldStrategy}`);
  }

  // FK constraints from parent entities (Phase 3)
  if (input.fkConstraints?.length) {
    parts.push(`\n## Cross-Entity FK Constraints`);
    parts.push(
      `The following parent entities have already been mapped. When this entity ` +
      `references these parent IDs, use the SAME hash pattern for consistency.\n`
    );
    for (const c of input.fkConstraints) {
      parts.push(`### ${c.entityName}.${c.idField}`);
      if (c.hashColumns?.length) {
        parts.push(`- Hash columns: [${c.hashColumns.join(", ")}]`);
      }
      if (c.transform) {
        parts.push(`- Transform: ${c.transform}`);
      }
      parts.push(
        `- When this entity has a foreign key referencing ${c.entityName}, ` +
        `map as identity pass-through from staging dependency.`
      );
      parts.push("");
    }
  }

  // Current entity pipeline YAML — gives agent full picture of all column mappings
  if (input.pipelineYamlSpec) {
    parts.push(`\n## Current Entity Pipeline (YAML)\n`);
    parts.push(
      `This is the current pipeline specification for **${entityName}**. ` +
      `It shows all columns, their sources, transforms, and dtypes. ` +
      `Use this to understand the full entity structure and ensure your mapping is consistent.\n`
    );
    parts.push("```yaml");
    parts.push(input.pipelineYamlSpec.trim());
    parts.push("```");
  }

  // Warn about pipeline sources that have no matching source schema
  if (input.unmatchedPipelineSources && input.unmatchedPipelineSources.length > 0) {
    parts.push(`\n## Pipeline Sources Without Schema\n`);
    parts.push(
      `The entity pipeline declares the following source tables, but NO source schema ` +
      `is available for them. DO NOT guess field names. Use \`query_bigquery\` to explore ` +
      `their structure, or flag fields requiring these tables as requires_context.\n`
    );
    for (const name of input.unmatchedPipelineSources) {
      parts.push(`- **${name}** — no schema available`);
    }
  }

  parts.push(`\n## Target Field: ${targetField.name}`);
  const meta: string[] = [];
  if (targetField.dataType) meta.push(`Type: ${targetField.dataType}`);
  if (targetField.isRequired) meta.push("Required: yes");
  if (targetField.isKey) meta.push("KEY FIELD");
  if (meta.length) parts.push(meta.join(" | "));
  if (targetField.description) parts.push(`Description: ${targetField.description}`);
  if (targetField.isKey) {
    parts.push(`**This is a KEY field.** See the Hash ID Convention in the mapping conventions above — use hash_id for PKs, direct identity for FK pass-throughs.`);
  }
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

  // Sibling fields in the same entity — two-tier layout
  if (siblingFields && siblingFields.length > 0) {
    const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const structuralSiblings = siblingFields
      .filter((sf) => sf.transform && (sf.confidence === "high" || sf.confidence === "medium"))
      .sort((a, b) => (CONFIDENCE_RANK[b.confidence ?? ""] ?? 0) - (CONFIDENCE_RANK[a.confidence ?? ""] ?? 0))
      .slice(0, ragEnabled ? 3 : 5);

    if (ragEnabled) {
      // RAG mode: top 3 structural siblings + 1-line summary + tool hint
      const mappedCount = siblingFields.filter((sf) => sf.mappingStatus !== "unmapped").length;
      // Determine primary source from sibling mappings
      const sourceCounts = new Map<string, number>();
      for (const sf of siblingFields) {
        if (sf.sourceInfo) {
          const table = sf.sourceInfo.split(".")[0];
          sourceCounts.set(table, (sourceCounts.get(table) || 0) + 1);
        }
      }
      let primarySource = "";
      let maxCount = 0;
      for (const [table, count] of sourceCounts) {
        if (count > maxCount) { primarySource = table; maxCount = count; }
      }

      parts.push(`\n## Sibling Fields Summary`);
      parts.push(
        `${siblingFields.length} siblings, ${mappedCount} mapped` +
        (primarySource ? `, primary source: ${primarySource}` : "") +
        `. Use \`get_sibling_mappings\` for details.`
      );

      if (structuralSiblings.length > 0) {
        parts.push(`\n### Key Structural Patterns\n`);
        for (const sf of structuralSiblings) {
          const dtype = sf.dataType ? ` (${sf.dataType})` : "";
          const source = sf.sourceInfo ? ` \u2190 ${sf.sourceInfo}` : "";
          parts.push(`**${sf.name}**${dtype} \u2014 ${sf.mappingStatus}${source}`);
          if (sf.mappingType) parts.push(`- Type: ${sf.mappingType}`);
          if (sf.transform) parts.push(`- Transform: ${sf.transform}`);
          if (sf.reasoning) parts.push(`- Reasoning: ${sf.reasoning}`);
          parts.push("");
        }
      }
    } else {
      // Legacy mode: full two-tier layout
      parts.push(`\n## Other Fields in This Entity (${siblingFields.length} total)`);

      const structuralIds = new Set(structuralSiblings.map((s) => s.name));

      if (structuralSiblings.length > 0) {
        parts.push(`\n### Mapped Siblings with Structural Patterns\n`);
        for (const sf of structuralSiblings) {
          const dtype = sf.dataType ? ` (${sf.dataType})` : "";
          const source = sf.sourceInfo ? ` \u2190 ${sf.sourceInfo}` : "";
          parts.push(`**${sf.name}**${dtype} \u2014 ${sf.mappingStatus}${source}`);
          if (sf.mappingType) parts.push(`- Type: ${sf.mappingType}`);
          if (sf.transform) parts.push(`- Transform: ${sf.transform}`);
          if (sf.reasoning) parts.push(`- Reasoning: ${sf.reasoning}`);
          parts.push("");
        }
      }

      // Tier 2: everything else as one-liners
      const otherSiblings = siblingFields.filter((sf) => !structuralIds.has(sf.name));
      if (otherSiblings.length > 0) {
        parts.push(`\n### Other Sibling Fields\n`);
        for (const sf of otherSiblings) {
          const dtype = sf.dataType ? ` (${sf.dataType})` : "";
          const source = sf.sourceInfo ? ` \u2190 ${sf.sourceInfo}` : "";
          parts.push(`- ${sf.name}${dtype} \u2014 ${sf.mappingStatus}${source}`);
        }
      }
    }
  }

  // Source schema catalog — skip in RAG mode (agent uses search_source_schema)
  if (ragEnabled) {
    if (sourceSchemaStats) {
      parts.push(`\n## Source Schema`);
      parts.push(
        `${sourceSchemaStats.tableCount} source tables with ${sourceSchemaStats.fieldCount} total fields.` +
        (sourceSchemaStats.primarySource ? ` Primary source: ${sourceSchemaStats.primarySource}.` : "") +
        ` Use \`search_source_schema\` to find relevant fields.`
      );
    }
  } else {
    if (sourceSchema && sourceSchema.length > 0) {
      parts.push(`\n## Available Source Schema\n`);
      for (const se of sourceSchema) {
        const fieldList = se.fields
          .map((f) => {
            let line = `- ${f.name}${f.dataType ? ` (${f.dataType})` : ""}`;
            if (f.description) line += ` — ${f.description}`;
            return line;
          })
          .join("\n");
        parts.push(`### ${se.entityName}\n${fieldList}\n`);
      }
    }

    // Source data preview from BigQuery (only in legacy mode)
    if (sourceDataPreview) {
      parts.push(renderSourceDataPreview(sourceDataPreview));
    }
  }

  // Prior discussion history
  if (priorDiscussionSummary) {
    parts.push(`\n## Prior Discussion History\n`);
    parts.push(priorDiscussionSummary);
  }

  // Entity-level learnings from other fields' sessions
  if (entityLearnings && entityLearnings.length > 0) {
    parts.push(`\n## Learnings from Other Fields in This Entity\n`);
    parts.push(
      `The following corrections and insights were gathered from discussions about other fields ` +
      `in the **${entityName}** entity. Apply these to your approach — do NOT repeat mistakes ` +
      `that were already corrected on sibling fields.\n`
    );
    for (const learning of entityLearnings) {
      parts.push(`- **${learning.fieldName}**: ${learning.correction}`);
    }
  }

  // Cross-entity learnings from other entities in the workspace
  if (crossEntityLearnings && crossEntityLearnings.length > 0) {
    parts.push(`\n## Insights from Other Entities\n`);
    parts.push(
      `The following corrections were made during discussions about other entities in this workspace. ` +
      `Use your domain knowledge to determine which patterns apply to **${entityName}** — ` +
      `conceptually related entities often share similar mapping approaches, data quirks, ` +
      `and source field behaviors.\n`
    );
    // Group by entity for readability, include description for domain context
    const byEntity = new Map<string, { description: string | null; items: { fieldName: string; correction: string }[] }>();
    for (const l of crossEntityLearnings) {
      if (!byEntity.has(l.entityName)) {
        byEntity.set(l.entityName, { description: l.entityDescription, items: [] });
      }
      byEntity.get(l.entityName)!.items.push({ fieldName: l.fieldName, correction: l.correction });
    }
    for (const [entName, { description, items }] of byEntity) {
      const desc = description ? ` — ${description}` : "";
      parts.push(`\n**${entName}**${desc}:`);
      for (const item of items) {
        parts.push(`- ${item.fieldName}: ${item.correction}`);
      }
    }
  }

  // Answered questions from SM team — prevents re-flagging resolved gaps
  if (input.answeredQuestions && input.answeredQuestions.length > 0) {
    parts.push(`\n## Resolved Context Gaps\n`);
    parts.push(
      `The following questions were previously flagged and answered by a subject-matter expert. ` +
      `Treat these answers as authoritative — do NOT re-flag these as context gaps.\n`
    );
    for (const aq of input.answeredQuestions) {
      const fieldLabel = aq.fieldName ? ` (${aq.fieldName})` : "";
      parts.push(`**Q${fieldLabel}**: ${aq.question}`);
      parts.push(`**A**: ${aq.answer}\n`);
    }
  }

  // Reference materials — skip in RAG mode (agent uses get_reference_docs)
  // Each doc tagged with [ref:ctx_ID] for citation traceability
  if (!ragEnabled) {
    if (assembledContext.primaryContexts.length > 0) {
      parts.push(`\n## Primary Reference Documents\n`);
      for (const c of assembledContext.primaryContexts) {
        parts.push(`### [ref:ctx_${c.id}] ${c.name}\n\n${c.content}`);
      }
    }

    if (assembledContext.referenceContexts.length > 0) {
      parts.push(`\n## Reference Materials\n`);
      for (const c of assembledContext.referenceContexts) {
        parts.push(`### [ref:ctx_${c.id}] ${c.name}\n\n${c.content}`);
      }
    }

    if (assembledContext.supplementaryContexts.length > 0) {
      parts.push(`\n## Supplementary Context\n`);
      for (const c of assembledContext.supplementaryContexts) {
        parts.push(`### [ref:ctx_${c.id}] ${c.name}\n\n${c.content}`);
      }
    }
  } else {
    const totalDocs =
      assembledContext.primaryContexts.length +
      assembledContext.referenceContexts.length +
      assembledContext.supplementaryContexts.length;
    if (totalDocs > 0) {
      parts.push(`\n## Reference Documents`);
      parts.push(
        `${totalDocs} reference document(s) available. Use \`get_reference_docs\` to retrieve by topic.`
      );
    }
  }

  // Append domain-specific rules, workspace-scoped learnings, and universal context
  let systemMessage = CHAT_SYSTEM_MESSAGE;
  systemMessage += renderWorkspaceRulesSection(input.workspaceRules);

  if (input.workspaceId) {
    const bundle = await getSystemContextBundle(input.workspaceId);
    if (bundle.totalTokens > 0) {
      systemMessage += renderSystemContextSection(bundle);
    }
  }

  if (bigqueryAvailable && baselineDataPreloaded) {
    systemMessage += `

BIGQUERY DATA ACCESS:
Source data preview is PRE-LOADED in your context above. Do NOT re-query for sample rows, null rates, or distinct values already shown.

You have access to a \`query_bigquery\` tool for follow-up queries${bigqueryDataset ? ` (dataset: ${bigqueryDataset})` : ""}.

Only use the query_bigquery tool when:
- The user explicitly asks you to check something specific
- You need data about a DIFFERENT table than what's pre-loaded
- You need cross-table joins or conditional aggregations not in the preview

Best practices:
- Always use LIMIT (max 25 rows) — the tool enforces this but be explicit
- Write focused queries: select only the columns you need
- Summarize results concisely after receiving them

Do NOT:
- Re-query for data already shown in Source Data Preview
- Run queries speculatively without the user asking or a clear mapping need
- Try to modify data (only SELECT/WITH are allowed)
- Run expensive full-table scans — always filter or limit`;
  } else if (bigqueryAvailable) {
    systemMessage += `

BIGQUERY DATA ACCESS:
You have access to a \`query_bigquery\` tool that lets you run read-only SQL queries against the source data in BigQuery${bigqueryDataset ? ` (dataset: ${bigqueryDataset})` : ""}.

When to use it:
- The user asks to check actual data values, distributions, or examples
- You need to verify a mapping assumption (e.g. "does this field actually contain dates?")
- You want to check distinct values, null rates, or data patterns
- The user asks "can you query that?" or similar

Best practices:
- Always use LIMIT (max 25 rows) — the tool enforces this but be explicit
- Write focused queries: select only the columns you need
- Use COUNT/DISTINCT/GROUP BY for summaries rather than dumping raw rows
- Explain what you're checking and why before querying
- Summarize results concisely after receiving them

Do NOT:
- Run queries speculatively without the user asking or a clear mapping need
- Try to modify data (only SELECT/WITH are allowed)
- Run expensive full-table scans — always filter or limit`;
  }

  // Add RAG retrieval tool instructions when enabled
  if (ragEnabled) {
    systemMessage += `

RETRIEVAL TOOLS:
You have tools to retrieve context on demand. Use them BEFORE proposing a mapping.

1. \`search_source_schema\` — Search source tables/fields by keyword, table, or data type
2. \`get_reference_docs\` — Retrieve domain docs, business rules, code breakers
3. \`get_sibling_mappings\` — Look up how sibling fields in this entity are mapped
4. \`get_mapping_examples\` — Find examples of similar mappings across the workspace${bigqueryAvailable ? `\n5. \`query_bigquery\` — Run read-only SQL queries against source data` : ""}

RECOMMENDED WORKFLOW:
1. Check sibling patterns: get_sibling_mappings(filter: "by_source_table") — identify primary source
2. Search for source fields: search_source_schema(query: "<target_field_keywords>")
3. If enum/boolean/date/ID: get_mapping_examples(fieldType: "<type>")
4. If unfamiliar domain concept: get_reference_docs(query: "<concept>")
5. Verify with BigQuery if needed

Call multiple tools in a single turn when possible. Do NOT guess at field names — search first.`;
  }

  return {
    systemMessage,
    contextMessage: parts.join("\n"),
  };
}
