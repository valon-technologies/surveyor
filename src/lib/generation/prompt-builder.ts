import type { AssembledContext } from "./context-assembler";
import { GOLD_FORMAT_EXAMPLES, GOLD_FORMAT_PITFALLS } from "./gold-format-reference";
import { RENDERER_EXPRESSION_CONTEXT, RENDERER_FILTER_REFERENCE } from "./renderer-reference";

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
  fields: { name: string; dataType: string | null; description?: string | null }[];
}

interface PromptInput {
  entityName: string;
  entityDescription: string | null;
  targetFields: TargetField[];
  assembledContext: AssembledContext;
  sourceSchema?: SourceEntitySchema[];
  learnings?: string[];
}

const SYSTEM_MESSAGE = `You are a data mapping API that outputs ONLY valid JSON. No prose, no markdown, no explanations — just a JSON object.

Your task: given target fields and reference documents, produce a mapping specification for each target field, plus any questions about uncertainties.

OUTPUT FORMAT: A single JSON object with "mappings" and "questions" arrays. No text before or after. No code fences. Example:

{"mappings":[{"targetFieldName":"field_name","status":"unreviewed","mappingType":"direct","sourceEntityName":"src_table","sourceFieldName":"src_col","transform":null,"defaultValue":null,"enumMapping":null,"reasoning":"Direct 1:1 match on name and type","confidence":"high","uncertaintyType":null,"notes":null,"reviewComment":null}],"questions":[{"targetFieldName":"other_field","questionText":"Which source table contains the delinquency status?","questionType":"no_source_match","priority":"high"}]}

MAPPING SCHEMA (every object in "mappings" must have these keys):
- targetFieldName (string): exact target field name from the request
- status (string): "unreviewed" | "unmapped"
- mappingType (string|null): "direct" | "rename" | "type_cast" | "enum" | "flatten_to_normalize" | "aggregate" | "join" | "derived" | "pivot" | "conditional"
- sourceEntityName (string|null): source entity/table name
- sourceFieldName (string|null): source field/column name
- transform (string|null): SQL expression if transformation needed
- defaultValue (string|null): default if no source exists
- enumMapping (object|null): {"source_val": "target_val"} for enum mappings
- reasoning (string): 1-2 sentence explanation
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

UNCERTAINTY TYPES:
- no_source_match: No source field could be confidently matched to this target
- multiple_candidates: Multiple source fields are plausible — human must pick
- unclear_transform: Source exists but the correct transformation logic is uncertain
- incomplete_enum: Enum mapping is missing values or source codes are undocumented
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
- ENUM FIELDS — COMPLETENESS REQUIRED: Source systems use short codes. Map with CASE WHEN. COUNT the target field's allowed enum values. Your CASE WHEN MUST produce ALL target values plus an ELSE NULL. If target has 5 enum values, you need 5 output branches. Before submitting, verify: (a) every target enum value appears in your CASE output, (b) every known source code is handled, (c) ELSE clause exists for unknown codes. If the source already contains the target values, use identity.
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
- UNMAPPABLE FIELDS: If no source column semantically matches and no reasonable derivation exists, set status to "unmapped" — don't force a bad mapping.

SELF-REVIEW CHECKLIST (verify before outputting):
1. Every source field referenced exists in "Available Source Schema" — no invented names
2. Every enum mapping covers ALL target enum values (count them)
3. No CAST(x AS BOOL) patterns — use equality checks instead
4. Every target field has exactly one mapping entry (count: ${"`"}mappings.length === requested fields${"`"})
5. Confidence is calibrated honestly — not everything should be "high"
6. Every medium/low mapping has both uncertaintyType and reviewComment
7. Questions generated for genuine uncertainties that a human can resolve`;

export function buildPrompt(input: PromptInput): { systemMessage: string; userMessage: string } {
  const { entityName, entityDescription, targetFields, assembledContext, sourceSchema } = input;

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

  // Source schema
  if (sourceSchema && sourceSchema.length > 0) {
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

  // Inject learnings from prior training
  if (input.learnings?.length) {
    parts.push(`\n## Learnings from Prior Training\n`);
    parts.push(`Apply these insights — they were learned from expert review of similar mappings:\n`);
    for (const l of input.learnings) {
      parts.push(`- ${l}`);
    }
  }

  // Reinforce JSON-only output at the end of the user message
  parts.push(`\n---\nRespond with ONLY the JSON object containing "mappings" (array of ${targetFields.length} field mappings) and "questions" (array of any uncertainties needing human input). No other text.`);

  return {
    systemMessage: SYSTEM_MESSAGE,
    userMessage: parts.join("\n"),
  };
}

// ── YAML output format ──

const YAML_SYSTEM_MESSAGE = `You are a data mapping API that outputs ONLY valid YAML. No prose, no markdown, no explanations — just a YAML document.

Your task: given target fields and source schema, produce a mapping specification in YAML format that fully describes the ETL pipeline: sources, joins, and per-column transforms.

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

  - target_column: <unmapped_field>
    source: []
    transform: null
    dtype: string

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

MAPPING CONVENTIONS:
- PREFER IDENTITY: Check if the source column already contains data in the correct format before writing expressions. A direct identity mapping is always preferred over a complex transform.
- BOOLEAN FIELDS: Source systems store booleans as indicator codes ('Y'/'N', '1'/'0', status codes). Convert using .eq() or .isin() checks, NOT CAST. Example: fi.ArmIndicator.eq("Y"), fi.BalloonStatusCode.isin(["A","H"])
- ENUM FIELDS — COMPLETENESS REQUIRED: Source systems use short codes. Map with np.select or .map(). COUNT the target field's allowed enum values. Your mapping MUST produce ALL target values plus a pd.NA default for unknown codes. If target has 5 enum values, you need 5 output branches. Before submitting, verify: (a) every target enum value appears in your mapping output, (b) every known source code is handled, (c) default exists for unknown codes. If the source already contains target values, use identity.
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
- UNMAPPABLE FIELDS: If no source exists, use source: [] and transform: null — don't force a mapping.

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

SELF-REVIEW CHECKLIST (verify before outputting):
1. Every source field referenced exists in "Available Source Schema" — no invented names
2. Every enum mapping covers ALL target enum values (count them)
3. No CAST(x AS BOOL) patterns — use equality checks instead
4. Every target field has exactly one column entry (count check)
5. Prefer identity transforms — don't over-engineer simple 1:1 matches
6. Questions generated for genuine uncertainties that a human can resolve`;

export function buildYamlPrompt(input: PromptInput): { systemMessage: string; userMessage: string } {
  const { entityName, entityDescription, targetFields, assembledContext, sourceSchema } = input;

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

  // Source schema
  if (sourceSchema && sourceSchema.length > 0) {
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

  // Inject learnings from prior training
  if (input.learnings?.length) {
    parts.push(`\n## Learnings from Prior Training\n`);
    parts.push(`Apply these insights — they were learned from expert review of similar mappings:\n`);
    for (const l of input.learnings) {
      parts.push(`- ${l}`);
    }
  }

  // Reinforce YAML-only output
  parts.push(`\n---\nRespond with ONLY the YAML mapping document for the ${targetFields.length} fields above. Include a "questions:" section if there are uncertainties needing human input. No other text.`);

  return {
    systemMessage: YAML_SYSTEM_MESSAGE,
    userMessage: parts.join("\n"),
  };
}
