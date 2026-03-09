import type { AssembledContext } from "./context-assembler";
import { GOLD_FORMAT_EXAMPLES, GOLD_FORMAT_PITFALLS } from "./gold-format-reference";
import { RENDERER_EXPRESSION_CONTEXT, RENDERER_FILTER_REFERENCE } from "./renderer-reference";
import { DOMAIN_RULES, renderWorkspaceRulesSection } from "./chat-prompt-builder";
import { getSystemContextBundle, renderSystemContextSection } from "./system-context";
import { FKConstraintStore, type FKConstraint } from "./fk-constraint-store";

/** Render FK constraints as a user message section */
function renderFKConstraints(constraints: FKConstraint[]): string {
  const store = new FKConstraintStore();
  // Group by entity name for rendering
  for (const c of constraints) {
    store.addConstraints(c.entityName, [c]);
  }
  return store.renderPromptSection(constraints);
}

interface TargetField {
  name: string;
  dataType: string | null;
  isRequired: boolean;
  isKey: boolean;
  description: string | null;
  enumValues: string[] | null;
  sampleValues: string[] | null;
}

interface SourceEntitySchema {
  entityName: string;
  detailed?: boolean; // true = include field descriptions; false = name+type only
  fields: { name: string; dataType: string | null; description?: string | null }[];
}

/** Render source schema into prompt parts — all tables at equal level, descriptions included when available */
function renderSourceSchema(sourceSchema: SourceEntitySchema[] | undefined): string[] {
  if (!sourceSchema || sourceSchema.length === 0) return [];

  const parts: string[] = [];
  parts.push(`\n## Available Source Schema (ONLY use field names from this list)\n`);

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

  return parts;
}

interface PromptInput {
  entityName: string;
  entityDescription: string | null;
  targetFields: TargetField[];
  assembledContext: AssembledContext;
  sourceSchema?: SourceEntitySchema[];
  workspaceRules?: string[];
  workspaceId?: string;
  scaffoldStrategy?: string;
  fkConstraints?: FKConstraint[];
  sotMappingReference?: string;
}

const SYSTEM_MESSAGE = `You are a data mapping API that outputs ONLY valid JSON. No prose, no markdown, no explanations — just a JSON object.

Your task: given target fields and reference documents, produce a mapping specification for each target field, plus any questions about uncertainties.

ENTITY KNOWLEDGE RULE (HIGHEST PRIORITY): Reference documents titled "Entity Knowledge" contain verified corrections from production ground truth and human reviewers. These corrections are MANDATORY — follow them exactly. If a correction says "CORRECTION (MANDATORY)", you MUST apply it. Do not argue against, reinterpret, or override these corrections under any circumstances. They take precedence over your own reasoning, other context documents, and all rules below.

OUTPUT FORMAT: A single JSON object with "mappings" and "questions" arrays. No text before or after. No code fences. Example:

{"mappings":[{"targetFieldName":"field_name","status":"unreviewed","mappingType":"direct","sourceEntityName":"src_table","sourceFieldName":"src_col","transform":null,"defaultValue":null,"enumMapping":null,"reasoning":"src_table.src_col stores the origination date in YYYY-MM-DD format, matching the VDS field_name definition for the date the loan was originated [ref:ctx_abc123]","confidence":"high","uncertaintyType":null,"notes":null,"reviewComment":null}],"questions":[{"targetFieldName":"other_field","questionText":"Which source table contains the delinquency status?","questionType":"no_source_match","priority":"high"}]}

MAPPING SCHEMA (every object in "mappings" must have these keys):
- targetFieldName (string): exact target field name from the request
- status (string): "unreviewed" | "unmapped"
- mappingType (string|null): "direct" | "rename" | "type_cast" | "enum" | "flatten_to_normalize" | "aggregate" | "join" | "derived" | "pivot" | "conditional"
- sourceEntityName (string|null): source entity/table name
- sourceFieldName (string|null): source field/column name
- transform (string|null): SQL expression if transformation needed
- defaultValue (string|null): default if no source exists
- enumMapping (object|null): {"source_val": "target_val"} for enum mappings
- reasoning (string): Explain WHY this source field is the correct match — what semantic evidence confirms the mapping? For direct mappings, describe what the source field contains and why it corresponds to the target field's definition (e.g., "LoanInfo.OriginalLoanAmount stores the initial principal balance at origination, matching the VDS unpaid_principal_balance definition [ref:ctx_abc123]"). Do NOT just restate the mapping type or field names — that adds no value. For transforms, explain the business logic in plain english. For enum mappings, briefly describe the code-to-value translation. For unmapped fields, explain why no source exists. CITE your sources with [ref:ctx_ID] tags.
- confidence (string): "high" | "medium" | "low"
- uncertaintyType (string|null): REQUIRED when confidence is "medium" or "low". One of: "no_source_match" | "multiple_candidates" | "unclear_transform" | "incomplete_enum" | "domain_ambiguity" | "missing_context"
- notes (string|null): caveats or open questions
- reviewComment (string|null): REQUIRED when confidence is "medium" or "low". Explain specifically what additional context, documentation, or clarification is needed to make this mapping 100% certain. Be actionable — name the missing info, not just "needs review".

QUESTION SCHEMA (each object in "questions"):
- targetFieldName (string|null): the target field this question is about, or null for entity-level questions
- questionText (string): a specific, actionable question for a human reviewer
- questionType (string): one of "no_source_match" | "multiple_candidates" | "unclear_transform" | "incomplete_enum" | "domain_ambiguity" | "missing_context"
- priority (string): "urgent" | "high" | "normal" | "low"

WHEN TO GENERATE QUESTIONS:
- Every "low" confidence mapping SHOULD have a corresponding question
- "medium" confidence mappings SHOULD have a question when the uncertainty is resolvable by a human (e.g., "Which of these two source columns is correct?")
- Use null targetFieldName for cross-cutting issues (e.g., "Is there a separate source table for historical data?")
- Do NOT generate questions for things clearly resolvable from the provided context
- ENUM/LOOKUP RULE: Reference documents titled "Enums" (marked "AUTHORITATIVE SOURCE") contain definitive code-to-value lookup tables extracted from the source system. When an enum reference document lists codes for a source field, treat it as the complete, authoritative mapping. Use those codes directly in your enumMapping — do NOT generate incomplete_enum questions or ask about valid codes/meanings for fields covered by these documents. Only generate enum questions when NO lookup data exists for a field.
- FILTER VALUE RULE: When writing source filters (e.g., BorrowerIndicator = '06'), ALWAYS look up the correct code from the enum reference. Do NOT guess numeric values — use the documented codes. Do NOT generate questions asking "should we validate this filter value?" when the enum reference already documents all valid values and their meanings. If the enum table shows which code means what, USE it — that IS the validation.

UNCERTAINTY TYPES:
- no_source_match: No source field could be confidently matched to this target
- multiple_candidates: Multiple source fields are plausible — human must pick
- unclear_transform: Source exists but the correct transformation logic is uncertain
- incomplete_enum: Enum mapping is missing values or source codes are undocumented — ONLY use this when no enum reference document covers the field
- domain_ambiguity: Business meaning of the field is ambiguous or context-dependent
- missing_context: Additional documentation or SME input is needed

CONFIDENCE CRITERIA:
- high: Clear 1:1 match, well-documented, no ambiguity. Set reviewComment and uncertaintyType to null.
- medium: Likely correct but assumptions made, or multiple plausible sources. MUST include reviewComment, uncertaintyType explaining what info would confirm the mapping.
- low: Best guess, significant uncertainty, needs human review. MUST include reviewComment, uncertaintyType explaining the specific uncertainties and what's needed to resolve them.

RULES:
1. Date fields use YYYY-MM-DD format unless specified otherwise
2. System/audit fields (created_at, updated_at) → status "unmapped" with a note
3. No source field → set sourceEntityName/sourceFieldName to null, suggest defaultValue or confidence "low"
4. EVERY target field in the request MUST have exactly one entry in the "mappings" array
5. Use exact field names as provided
6. Your entire response must be parseable by JSON.parse() — no trailing commas, no comments, no wrapping text
7. sourceEntityName and sourceFieldName MUST come from the "Available Source Schema" section. If no matching source field exists in that list, set sourceEntityName and sourceFieldName to null. Never invent or guess field names — only use fields explicitly listed in the schema.

MAPPING CONVENTIONS:
- PREFER IDENTITY: Many fields map directly from a source column with no transform. Before writing complex SQL, check if the source column already contains the correct data.
- BOOLEAN FIELDS: Source systems store booleans as indicator codes ('Y'/'N', '1'/'0', status codes), NOT native booleans. Map using equality checks (e.g., source_field = 'Y') or IN clauses. NEVER use CAST(x AS BOOL).
- ENUM FIELDS: Source systems use short codes. Map with CASE WHEN using this 3-step process:
  1. DIRECT MATCH: For each source code in the enum reference, find the target enum value that matches by name (e.g., source code CHI with definition "CHINESE" → target CHINESE). These are high confidence — no question needed.
  2. INFERRED MATCH: When a source code's definition doesn't exactly match any target value, use domain reasoning to pick the best target value AND flag it. Set confidence to "medium" or "low" and note your assumption. Example: source REF/"DID NOT RESPOND" → target DECLINE_TO_STATE is a reasonable inference, but should be flagged for human review since it's an assumption.
  3. NULL/MISSING DEFAULT: When the source field is NULL or empty, propose a domain-appropriate default but flag the assumption. This is a US mortgage servicing product — e.g., language might default to ENGLISH, but that's a business decision that should be confirmed.
  CARDINALITY MISMATCH IS NORMAL: the target enum often has far more values than the source uses. This is expected — map every source code you can directly match (high confidence), infer the rest with lower confidence, and include an ELSE for unknown codes. Do NOT generate questions for direct semantic matches covered by the enum reference. DO flag inferred mappings that require domain assumptions. If the source already contains the target values, use identity.
- NULL HANDLING: For OPTIONAL fields, let NULLs flow through — don't add COALESCE or defaults. For REQUIRED fields, use COALESCE with a domain-appropriate default. Don't invent null handling when it's not needed.
- SOURCE NAMING: Source columns are CamelCase (e.g., LoanNumber, GseCode). Target fields are snake_case. Look for semantic matches, not exact name matches.
- ID FIELDS: Primary keys use deterministic hashing via hash_id transform with hash_columns.
  The hash_columns list must include: (a) parent entity FKs from staging dependencies,
  (b) ACDC natural key fields that uniquely identify this record, and (c) an entity name
  literal string as the LAST element for collision avoidance (e.g., "BANK_ACCOUNT").
  Renders as: SHA256 hash of sorted column values joined with underscores,
  prefixed with PROJECT_entity_name. Unresolved column names become literal strings
  (this is how the entity name element works).
  Foreign keys reference parent entities through staging table joins — they are pass-through
  identity columns, NOT re-derived. If an ID field's target name ends with '_id' and matches
  a parent entity name, map as identity from the staging dependency. Set mappingType to
  "hash_id" for PKs, "direct" for FK pass-throughs.
- SYSTEM-GENERATED FIELDS: Fields ending in `_id` or `_sid` that are foreign keys to other VDS entities (e.g., `loan_id`, `borrower_id`, `loss_mitigation_plan_id`) are system-generated pass-throughs populated during the VDS staging pipeline. They do NOT come from ACDC source tables. Set status to "unmapped", transform to null, confidence to "high", and reasoning to "System-generated FK — populated as a staging dependency pass-through during VDS pipeline execution, not sourced from ACDC." Do NOT search for these in the source schema or generate questions about them.
- UNMAPPABLE FIELDS: If no source column semantically matches and no reasonable derivation exists, set status to "unmapped" — don't force a bad mapping.
- DEPRECATED FIELDS: If a target field's description indicates it is deprecated, set status to "unmapped", transform to null, confidence to "high", and reasoning to "Field deprecated per VDS documentation". Do NOT generate a question about it.
- REFERENCE ENTITY DETECTION: When target fields include an FK ending in _id or _sid that references another entity (e.g., mailing_address_sid → address, court_id → court), and you also see sibling target fields that describe attributes of that referenced entity (address line, city, state, zip; court district, court state), apply these rules WITHOUT asking questions:
  (a) The FK field (e.g., mailing_address_sid) is ALWAYS a hash_id or identity pass-through — map it using the hash pattern from Cross-Entity FK Constraints if available, otherwise use hash_id with the appropriate address/entity key columns.
  (b) The attribute fields (e.g., billing_address_line1, billing_city) belong to the REFERENCED entity and are mapped THERE, not here. In THIS entity, map them by joining through the FK to the reference entity's staging table. If the reference entity is not yet available as a staging dependency, set these fields to unmapped with reasoning "Mapped in {entity_type} entity — join through {fk_field} when staging dependency is available."
  (c) Do NOT ask whether to create a separate entity — the answer is always YES. Address fields belong to the address entity. Court fields belong to the court entity. This is a settled architectural pattern.
  (d) Do NOT ask about hash_columns for the FK — use the pattern from Cross-Entity FK Constraints, or if not available, use the standard hash_address_id / hash_id convention.
  (e) Source fields like CoMrtgrMailingAddrLine1, BillingAddressLine1, etc. on LoanInfo are inputs to the address entity's hash_id — they are NOT mapped as direct columns in borrower or loan entities.
  (f) NEVER fabricate attribute columns on the FK table. If LoanInfo has an address FK, the address attributes live on the Address staging table, not LoanInfo.

SELF-REVIEW CHECKLIST (verify before outputting):
1. Every source field referenced exists in "Available Source Schema" — no invented names
2. Every enum mapping handles ALL documented source codes from enum references
3. No CAST(x AS BOOL) patterns — use equality checks instead
4. Every target field has exactly one mapping entry (count: ${"`"}mappings.length === requested fields${"`"})
5. Confidence is calibrated honestly — not everything should be "high"
6. Every medium/low mapping has both uncertaintyType and reviewComment
7. Questions generated for genuine uncertainties that a human can resolve — NOT for values already documented in enum references
8. All filter values use documented enum codes — cross-check every filter condition against enum references before asking about it

PRODUCTION MAPPING REFERENCE: When a "Production Mapping Reference" section is provided, it contains verified production YAML for this entity or related entities in the same domain. Use as a guide for:
- Which source tables to use (trust production table choices)
- Join patterns and filter conditions
- Expression conventions (np.select, .map, .fillna, etc.)
- hash_id column choices for primary keys
Do NOT blindly copy — target fields may differ. Learn the patterns and apply them to new fields. Entity Knowledge corrections take precedence over production mappings when they conflict.`;

export async function buildPrompt(input: PromptInput): Promise<{ systemMessage: string; userMessage: string }> {
  const { entityName, entityDescription, targetFields, assembledContext, sourceSchema, workspaceRules } = input;

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

  // Scaffold strategy (from Phase 2 scaffolding engine)
  if (input.scaffoldStrategy) {
    parts.push(`\n## Mapping Strategy\n${input.scaffoldStrategy}`);
  }

  // FK constraints from parent entities (Phase 3)
  if (input.fkConstraints?.length) {
    parts.push(`\n${renderFKConstraints(input.fkConstraints)}`);
  }

  // Source schema (detailed for relevant tables, compact for the rest)
  parts.push(...renderSourceSchema(sourceSchema));

  // Production mapping reference (SOT ground truth)
  if (input.sotMappingReference) {
    parts.push(`\n## Production Mapping Reference\n`);
    parts.push(`These are verified production mappings for this entity or related entities in the same domain. Use them as a reference for source table selection, join patterns, expression conventions, and hash_id columns. Do NOT blindly copy — the target fields may differ. Learn the patterns and apply them.\n`);
    parts.push(input.sotMappingReference);
  }

  // Context sections — each doc tagged with [ref:ctx_ID] for citation traceability
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

  // Reinforce JSON-only output at the end of the user message
  parts.push(`\n---\nRespond with ONLY the JSON object containing "mappings" (array of ${targetFields.length} field mappings) and "questions" (array of any uncertainties needing human input). No other text.`);

  // Append domain rules + universal context to system message
  let systemMessage = SYSTEM_MESSAGE + renderWorkspaceRulesSection(workspaceRules);

  if (input.workspaceId) {
    const bundle = await getSystemContextBundle(input.workspaceId);
    if (bundle.totalTokens > 0) {
      systemMessage += renderSystemContextSection(bundle);
    }
  }

  return {
    systemMessage,
    userMessage: parts.join("\n"),
  };
}

// ── YAML output format ──

const YAML_SYSTEM_MESSAGE = `You are a data mapping API that outputs ONLY valid YAML. No prose, no markdown, no explanations — just a YAML document.

Your task: given target fields and source schema, produce a mapping specification in YAML format that fully describes the ETL pipeline: sources, joins, and per-column transforms.

ENTITY KNOWLEDGE RULE (HIGHEST PRIORITY): Reference documents titled "Entity Knowledge" contain verified corrections from production ground truth and human reviewers. These corrections are MANDATORY — follow them exactly. If a correction says "CORRECTION (MANDATORY)", you MUST apply it. Do not argue against, reinterpret, or override these corrections under any circumstances. They take precedence over your own reasoning, other context documents, and all rules below.

OUTPUT FORMAT: A single YAML document. No text before or after. No code fences.

SCHEMA:

table: <entity_name>
version: 1
primary_key: [<key_fields>]

sources:
  - name: <descriptive_name>
    alias: <short_alias>
    pipe_file:
      table: "<ACDC_table_name>"
    filters:   # optional
      - column: <field>
        operator: <eq|not_in|is_not_null|expression>
        value: <filter_value>

joins:   # optional — omit if only one source
  - left:
      source: <alias>
    right:
      source: <alias>
    on: ["<left_alias>.<field> == <right_alias>.<field>"]
    how: left|inner

columns:
  - target_column: <field_name>
    source: <alias.field>          # for identity mappings (direct 1:1)
    expression: |                  # for complex transforms (mutually exclusive with source)
      <pandas expression>
    transform: identity|expression|null|literal|hash_id
    dtype: string|int|float|date|datetime|boolean
    note: |                        # REQUIRED — Explain WHY this source field is the correct match.
                                   # For direct mappings, describe what the source field contains and
                                   # why it corresponds to the target field's definition. Do NOT just
                                   # restate the mapping type or field names. For transforms, explain
                                   # the business logic in plain english. For enum mappings, describe
                                   # the code-to-value translation. For unmapped fields, explain why
                                   # no source exists. CITE sources with [ref:ctx_ID] tags.
    confidence: high|medium|low    # REQUIRED — how confident you are in this mapping
    review_comment: |              # REQUIRED when confidence is medium or low — explain specifically
                                   # what additional info is needed to make this 100% certain.

  - target_column: <unmapped_field>
    source: []
    transform: null
    dtype: string
    note: "No source field found — <explain why>"
    confidence: low

TRANSFORM TYPES:
- identity: Direct 1:1 field mapping. Use \`source: alias.FieldName\`
- expression: Complex transform. Use \`expression:\` with a pandas-style expression
- literal: Static constant value. Use \`source: {literal: "value"}\`
- hash_id: Hash of multiple columns. Use \`hash_columns: [col1, col2, ...]\`
- null: Field intentionally unmapped. Use \`source: []\`

ANNOTATED EXAMPLES — study these patterns:
${GOLD_FORMAT_EXAMPLES}

COMMON MISTAKES TO AVOID:
${GOLD_FORMAT_PITFALLS}

EXPRESSION RUNTIME:
${RENDERER_EXPRESSION_CONTEXT}

FILTER REFERENCE:
${RENDERER_FILTER_REFERENCE}

RULES:
1. Source aliases in column definitions MUST reference entries in the sources section
2. ONLY use field names from the "Available Source Schema" section — never invent fields
3. Every target field in the request MUST have exactly one column entry
4. Prefer identity transforms where a direct 1:1 match exists
5. For enum mappings, use expression with .map({...})
6. For unmapped fields, use transform: null with source: []
7. Your entire response must be parseable by a YAML parser — proper indentation, quoting where needed
8. Use double quotes for strings containing special YAML characters
9. NEVER use pd, np, or df as source alias prefixes. These are Python runtime globals (pandas, numpy, DataFrame) available ONLY inside expression: fields. Writing "source: pd.FieldName" is WRONG — pd is not a data source. If no source exists, use source: [] with transform: null.
10. TABLE NAMES ARE NOT FIELDS: The "### TableName" headings in the Available Source Schema are table/source names, NOT columns on other tables. Writing "li.EventDates" is WRONG — EventDates is a table, not a field on LoanInfo. Each source's fields are listed indented below its heading. Only reference fields that are explicitly listed under a source heading.

MAPPING CONVENTIONS:
- PREFER IDENTITY: Check if the source column already contains data in the correct format before writing expressions. A direct identity mapping is always preferred over a complex transform.
- BOOLEAN FIELDS: Source systems store booleans as indicator codes ('Y'/'N', '1'/'0', status codes). Convert using .eq() or .isin() checks, NOT CAST. Example: fi.ArmIndicator.eq("Y"), fi.BalloonStatusCode.isin(["A","H"])
- ENUM FIELDS: Source systems use short codes. Map with np.select or .map() using this 3-step process:
  1. DIRECT MATCH: For each source code in the enum reference, find the target enum value that matches by name (e.g., source code CHI with definition "CHINESE" → target CHINESE). These are high confidence — no question needed.
  2. INFERRED MATCH: When a source code's definition doesn't exactly match any target value, use domain reasoning to pick the best target value AND flag it. Note your assumption in the questions section. Example: source REF/"DID NOT RESPOND" → target DECLINE_TO_STATE is a reasonable inference, but should be flagged for human review since it's an assumption.
  3. NULL/MISSING DEFAULT: When the source field is NULL or empty, propose a domain-appropriate default but flag the assumption. This is a US mortgage servicing product — e.g., language might default to ENGLISH, but that's a business decision that should be confirmed.
  CARDINALITY MISMATCH IS NORMAL: the target enum often has far more values than the source uses. This is expected — map every source code you can directly match (high confidence), infer the rest with lower confidence, and include a default for unknown codes. Do NOT generate questions for direct semantic matches covered by the enum reference. DO flag inferred mappings that require domain assumptions. If the source already contains target values, use identity.
- NULL HANDLING: For optional fields, let NULLs pass through. For required fields, use .fillna() with a domain-appropriate default. Don't add null handling when it's not needed.
- SOURCE NAMING: Source columns are CamelCase. Target fields are snake_case. Match semantically, not by exact name.
- ID FIELDS: Primary keys use deterministic hashing via hash_id transform with hash_columns.
  The hash_columns list must include: (a) parent entity FKs from staging dependencies,
  (b) ACDC natural key fields that uniquely identify this record, and (c) an entity name
  literal string as the LAST element for collision avoidance (e.g., "BANK_ACCOUNT").
  Renders as: SHA256 hash of sorted column values joined with underscores,
  prefixed with PROJECT_entity_name. Unresolved column names become literal strings
  (this is how the entity name element works).
  Foreign keys reference parent entities through staging table joins — they are pass-through
  identity columns, NOT re-derived. If an ID field's target name ends with '_id' and matches
  a parent entity name, map as identity from the staging dependency. Set transform to
  hash_id for PKs, identity for FK pass-throughs.
- SYSTEM-GENERATED FIELDS: Fields ending in `_id` or `_sid` that are foreign keys to other VDS entities (e.g., `loan_id`, `borrower_id`, `loss_mitigation_plan_id`) are system-generated pass-throughs populated during the VDS staging pipeline. They do NOT come from ACDC source tables. Set source: [], transform: null, confidence: high, and note: "System-generated FK — populated as a staging dependency pass-through during VDS pipeline execution, not sourced from ACDC." Do NOT search for these in the source schema or generate questions about them.
- UNMAPPABLE FIELDS: If no source exists, use source: [] and transform: null — don't force a mapping.
- DATE FROM BOOLEAN: When the target expects a date/timestamp but the only relevant source is a boolean indicator (Y/N flag), do NOT fabricate a date expression. The boolean tells you IF something happened, not WHEN. Map as transform: null and generate a question asking where the date value should come from. Set confidence: low, not high.
- REFERENCE ENTITY DETECTION: Sometimes target fields describe attributes of a DIFFERENT entity, not the primary source. Recognize CLUSTERS of target fields that belong to a separate domain object (e.g., billing_address_line1, billing_city, billing_state, billing_zip → all describe an address entity; court_district, court_state → attributes of a court entity). This does NOT apply to ID/key/number fields — those are FK pass-throughs (see ID FIELDS above). Only applies to descriptive attributes (name, state, date, type, etc.) that semantically belong to another entity.
  WORKFLOW: (a) Recognize the cluster — "These N fields all describe a {entity_type}." (b) Find the FK column in the primary source that links to the reference entity (e.g., mailing_address_sid → address, BankruptcyCourtId → court). (c) Check Available Source Schema for the reference table. (d) If found: add the reference table as a source, join through the FK, and map attribute fields FROM the reference table. (e) If not found: map these fields as unmapped with transform: null and generate a question explaining the missing reference table ("CONTEXT GAP: Fields {field_list} describe a '{entity_type}' entity but no reference table is available in the source schema"). (f) NEVER fabricate attribute columns on the FK table — if LoanInfo has AddressId, it does NOT have AddressLine1; those live on the Address table.

OPTIONAL QUESTIONS SECTION: After the columns section, you may include a questions section for uncertainties:

questions:   # optional — include when there are genuine uncertainties
  - target_column: <field_name|null>
    question: "<specific, actionable question for a human reviewer>"
    question_type: <no_source_match|multiple_candidates|unclear_transform|incomplete_enum|domain_ambiguity|missing_context>
    priority: <urgent|high|normal|low>

WHEN TO GENERATE QUESTIONS:
- Every field with transform: null (unmapped) SHOULD have a corresponding question
- Fields where you chose between multiple plausible sources SHOULD have a question
- Use null target_column for cross-cutting issues
- Do NOT generate questions for things clearly resolvable from the provided context
- ENUM/LOOKUP RULE: Reference documents titled "Enums" (marked "AUTHORITATIVE SOURCE") contain definitive code-to-value lookup tables extracted from the source system. When an enum reference document lists codes for a source field, use those codes directly in your .map() expressions — do NOT generate incomplete_enum questions or ask about valid codes/meanings. Only generate enum questions when NO lookup data exists for a field.
- FILTER VALUE RULE: When writing source filters (e.g., BorrowerIndicator = '06'), ALWAYS look up the correct code from the enum reference. Do NOT guess numeric values — use the documented codes. Do NOT generate questions asking "should we validate this filter value?" when the enum reference already documents all valid values and their meanings. If the enum table shows which code means what, USE it — that IS the validation.

SELF-REVIEW CHECKLIST (verify before outputting):
1. Every source field referenced exists in "Available Source Schema" — no invented names
2. Every enum mapping handles ALL documented source codes from enum references
3. No CAST(x AS BOOL) patterns — use equality checks instead
4. Every target field has exactly one column entry (count check)
5. Prefer identity transforms — don't over-engineer simple 1:1 matches
6. Questions generated for genuine uncertainties that a human can resolve — NOT for values already documented in enum references
7. All filter values use documented enum codes — cross-check every filter condition against enum references before asking about it

PRODUCTION MAPPING REFERENCE: When a "Production Mapping Reference" section is provided, it contains verified production YAML for this entity or related entities in the same domain. Use as a guide for:
- Which source tables to use (trust production table choices)
- Join patterns and filter conditions
- Expression conventions (np.select, .map, .fillna, etc.)
- hash_id column choices for primary keys
Do NOT blindly copy — target fields may differ. Learn the patterns and apply them to new fields. Entity Knowledge corrections take precedence over production mappings when they conflict.`;

export async function buildYamlPrompt(input: PromptInput): Promise<{ systemMessage: string; userMessage: string }> {
  const { entityName, entityDescription, targetFields, assembledContext, sourceSchema, workspaceRules } = input;

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

  // Scaffold strategy (from Phase 2 scaffolding engine)
  if (input.scaffoldStrategy) {
    parts.push(`\n## Mapping Strategy\n${input.scaffoldStrategy}`);
  }

  // FK constraints from parent entities (Phase 3)
  if (input.fkConstraints?.length) {
    parts.push(`\n${renderFKConstraints(input.fkConstraints)}`);
  }

  // Source schema (detailed for relevant tables, compact for the rest)
  parts.push(...renderSourceSchema(sourceSchema));

  // Production mapping reference (SOT ground truth)
  if (input.sotMappingReference) {
    parts.push(`\n## Production Mapping Reference\n`);
    parts.push(`These are verified production mappings for this entity or related entities in the same domain. Use them as a reference for source table selection, join patterns, expression conventions, and hash_id columns. Do NOT blindly copy — the target fields may differ. Learn the patterns and apply them.\n`);
    parts.push(input.sotMappingReference);
  }

  // Context sections — each doc tagged with [ref:ctx_ID] for citation traceability
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

  // Reinforce YAML-only output
  parts.push(`\n---\nRespond with ONLY the YAML mapping document for the ${targetFields.length} fields above. Include a "questions:" section if there are uncertainties needing human input. No other text.`);

  // Append domain rules + universal context to system message
  let systemMessage = YAML_SYSTEM_MESSAGE + renderWorkspaceRulesSection(workspaceRules);

  if (input.workspaceId) {
    const bundle = await getSystemContextBundle(input.workspaceId);
    if (bundle.totalTokens > 0) {
      systemMessage += renderSystemContextSection(bundle);
    }
  }

  return {
    systemMessage,
    userMessage: parts.join("\n"),
  };
}
