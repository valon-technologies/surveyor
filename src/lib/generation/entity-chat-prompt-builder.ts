import type { AssembledContext } from "./context-assembler";

interface FieldSummary {
  name: string;
  dataType: string | null;
  isRequired: boolean;
  mappingStatus: string; // "mapped (high)", "unmapped", etc.
  mappingType: string | null;
  sourceInfo: string | null; // "Table.Column" or null
  transform: string | null;
  confidence: string | null;
}

interface EntityStructure {
  structureType: "flat" | "assembly";
  sources: { name: string; alias: string; table: string }[];
  joins?: { left: string; right: string; on: string[]; how: string }[] | null;
  hasConcat: boolean;
}

interface EntityLearning {
  fieldName: string;
  correction: string;
}

interface AnsweredQuestion {
  question: string;
  answer: string;
  fieldName: string | null;
}

interface SourceSchemaStats {
  tableCount: number;
  fieldCount: number;
  primarySource?: string;
}

export interface EntityChatPromptInput {
  entityName: string;
  entityDescription: string | null;
  fields: FieldSummary[];
  assembledContext: AssembledContext;
  entityStructure?: EntityStructure;
  pipelineYamlSpec?: string;
  entityLearnings?: EntityLearning[];
  answeredQuestions?: AnsweredQuestion[];
  bigqueryAvailable?: boolean;
  bigqueryDataset?: string;
  ragEnabled?: boolean;
  sourceSchemaStats?: SourceSchemaStats;
  unmatchedPipelineSources?: string[];
}

const ENTITY_CHAT_SYSTEM_MESSAGE = `You are a senior data mapping expert helping a user review and refine entity-level data mappings between a source system and a target schema. You are conversational, precise, and grounded in the reference materials provided.

SCOPE — ENTITY-LEVEL STRATEGY:
This conversation is about the ENTIRE entity, not a single field. You help with:
- Overall mapping strategy: which source tables to use, join patterns, structural decisions
- Bulk source corrections: "switch all demographic fields from FairLending to BorrowerDemographics"
- Assembly vs flat structure decisions: when to introduce staging components
- Source pattern review: identifying misaligned source tables across many fields
- Consistency audits: finding fields that break the dominant mapping pattern

MULTI-FIELD UPDATES:
When you want to propose changes to MULTIPLE fields at once, include a fenced block:

\`\`\`entity-mapping-updates
[
  {
    "targetFieldName": "field_name_1",
    "mappingType": "direct",
    "sourceEntityName": "table_name",
    "sourceFieldName": "column_name",
    "transform": null,
    "reasoning": "Switched to BorrowerDemographics per bulk correction",
    "confidence": "high"
  },
  {
    "targetFieldName": "field_name_2",
    "mappingType": "direct",
    "sourceEntityName": "table_name",
    "sourceFieldName": "column_name",
    "transform": null,
    "reasoning": "Same pattern as field_name_1",
    "confidence": "high"
  }
]
\`\`\`

Each update object can include: targetFieldName (required), mappingType, sourceEntityName, sourceFieldName, transform, defaultValue, enumMapping, reasoning, confidence, notes. Only include fields you want to change.

The user must explicitly accept the updates for them to be applied.

PIPELINE STRUCTURE UPDATES:
When you want to propose changes to the entity's pipeline structure (sources, joins, structure type), include:

\`\`\`pipeline-structure-update
{
  "addSources": [{ "name": "stg_new_table", "alias": "nt", "table": "new_source_table" }],
  "addJoins": [{ "left": "main", "right": "nt", "on": ["main.loan_id = nt.loan_id"], "how": "left" }],
  "reasoning": "Adding new_source_table for demographic fields"
}
\`\`\`

Available actions:
- structureType: Change to "flat" or "assembly"
- addSources / removeSources: Add new source tables or remove by alias
- addJoins / removeJoins / updateJoins: Modify join graph
- concat: Set union config or null to remove

IMPORTANT: After a structure change, field mappings may need updating to reference the new sources. Propose both a pipeline-structure-update AND entity-mapping-updates in the same message when appropriate.

The user must explicitly accept structure updates for them to be applied.

CONVERSATION OPENING:
When the conversation begins:
1. Summarize the current mapping state: how many fields, how many mapped vs unmapped, dominant source tables
2. Identify the most impactful improvements — fields with wrong sources, missing patterns, inconsistencies
3. Be opinionated: if you see clear bulk corrections, propose them immediately with an entity-mapping-updates block
4. Keep it concise — lead with your top 2-3 recommendations

RULES:
1. Always reference specific field names, table names, and document sources
2. Prefer source field names from available schema; use BigQuery to verify when uncertain
3. Keep responses focused — entity-level discussions can get sprawling; stay action-oriented
4. When proposing bulk updates, group by source table or by correction type
5. NEVER list every single field in your response — use the fields table in context and reference by name
6. After updates are accepted, acknowledge concisely and stop. Do not offer menus of next steps.
7. Be opinionated and propose-first. A wrong bulk proposal corrected in one turn is better than 3 rounds of questions.

MAPPING CONVENTIONS:
These principles apply to ALL mappings in this workspace.

1. PREFER SIMPLICITY — identity first. Many fields map directly from a single source column.
2. BOOLEAN FIELDS — use equality checks (= 'Y', IN ('A','H')), NEVER CAST to bool.
3. ENUM FIELDS — CASE WHEN with ALL target values covered + ELSE NULL.
4. DATE FIELDS — use identity if source is already date type.
5. NULL HANDLING — don't add COALESCE unless the target field is REQUIRED and source is nullable.
6. SOURCE COLUMN SELECTION — CamelCase source, snake_case target. Look for semantic matches.
7. ID/KEY FIELDS — SHA256 hash for PKs (hash_id), identity for FK pass-throughs.
8. UNMAPPABLE FIELDS — map as not_applicable if no source data exists.`;

export function buildEntityChatPrompt(input: EntityChatPromptInput): {
  systemMessage: string;
  contextMessage: string;
} {
  const {
    entityName,
    entityDescription,
    fields,
    assembledContext,
    entityStructure,
    pipelineYamlSpec,
    entityLearnings,
    answeredQuestions,
    bigqueryAvailable,
    bigqueryDataset,
    ragEnabled,
    sourceSchemaStats,
    unmatchedPipelineSources,
  } = input;

  const parts: string[] = [];

  // Entity overview
  parts.push(`# Entity Mapping Context`);
  parts.push(`\n## Target Entity: ${entityName}`);
  if (entityDescription) {
    parts.push(`Description: ${entityDescription}`);
  }

  // Entity architecture
  if (entityStructure) {
    if (entityStructure.structureType === "assembly") {
      parts.push(`\n## Entity Architecture: ASSEMBLY`);
      parts.push(
        `**This is an assembly entity.** It reads from staging components, not raw source tables.\n`
      );
      parts.push(`**Dependencies (staging components):**`);
      for (const src of entityStructure.sources) {
        parts.push(`- \`${src.alias}\` -> reads from \`${src.table}\` (component: ${src.name})`);
      }
      if (entityStructure.joins?.length) {
        parts.push(`\n**Joins between components:**`);
        for (const j of entityStructure.joins) {
          parts.push(`- ${j.left} ${j.how.toUpperCase()} JOIN ${j.right} ON ${j.on.join(", ")}`);
        }
      }
      if (entityStructure.hasConcat) {
        parts.push(`\n**UNION/CONCAT**: This assembly concatenates multiple component outputs.`);
      }
    } else {
      parts.push(`\n## Entity Architecture: FLAT`);
      parts.push(`This entity maps directly from source tables.\n`);
      if (entityStructure.sources.length > 0) {
        parts.push(`**Sources:**`);
        for (const src of entityStructure.sources) {
          parts.push(`- \`${src.alias}\` -> \`${src.table}\``);
        }
      }
    }
  }

  // Pipeline YAML
  if (pipelineYamlSpec) {
    parts.push(`\n## Current Entity Pipeline (YAML)\n`);
    parts.push("```yaml");
    parts.push(pipelineYamlSpec.trim());
    parts.push("```");
  }

  // Unmatched pipeline sources
  if (unmatchedPipelineSources && unmatchedPipelineSources.length > 0) {
    parts.push(`\n## Pipeline Sources Without Schema\n`);
    for (const name of unmatchedPipelineSources) {
      parts.push(`- **${name}** -- no schema available`);
    }
  }

  // All fields status table
  const FIELD_TABLE_CAP = 60;
  const mappedCount = fields.filter((f) => f.mappingStatus !== "unmapped").length;
  const unmappedCount = fields.length - mappedCount;

  parts.push(`\n## Fields Overview (${fields.length} total: ${mappedCount} mapped, ${unmappedCount} unmapped)\n`);

  // Source pattern summary
  const sourceCounts = new Map<string, number>();
  for (const f of fields) {
    if (f.sourceInfo) {
      const table = f.sourceInfo.split(".")[0];
      sourceCounts.set(table, (sourceCounts.get(table) || 0) + 1);
    }
  }
  if (sourceCounts.size > 0) {
    parts.push(`**Source pattern:**`);
    const sorted = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [table, count] of sorted) {
      parts.push(`- ${table}: ${count} field${count !== 1 ? "s" : ""}`);
    }
    parts.push("");
  }

  // Compact field table
  if (fields.length <= FIELD_TABLE_CAP) {
    parts.push(`| Field | Type | Status | Source | Confidence |`);
    parts.push(`| --- | --- | --- | --- | --- |`);
    for (const f of fields) {
      const dtype = f.dataType || "-";
      const source = f.sourceInfo || "-";
      const conf = f.confidence || "-";
      parts.push(`| ${f.name} | ${dtype} | ${f.mappingStatus} | ${source} | ${conf} |`);
    }
  } else {
    // Large entity: show summary + instruct to use tool
    parts.push(`| Field | Type | Status | Source | Confidence |`);
    parts.push(`| --- | --- | --- | --- | --- |`);
    for (const f of fields.slice(0, FIELD_TABLE_CAP)) {
      const dtype = f.dataType || "-";
      const source = f.sourceInfo || "-";
      const conf = f.confidence || "-";
      parts.push(`| ${f.name} | ${dtype} | ${f.mappingStatus} | ${source} | ${conf} |`);
    }
    parts.push(`\n*... ${fields.length - FIELD_TABLE_CAP} more fields. Use \`get_sibling_mappings\` to see all.*`);
  }

  // Entity learnings
  if (entityLearnings && entityLearnings.length > 0) {
    parts.push(`\n## Entity Knowledge & Learnings\n`);
    for (const l of entityLearnings) {
      parts.push(`- **${l.fieldName}**: ${l.correction}`);
    }
  }

  // Answered questions
  if (answeredQuestions && answeredQuestions.length > 0) {
    parts.push(`\n## Resolved Context Gaps\n`);
    for (const aq of answeredQuestions) {
      const fieldLabel = aq.fieldName ? ` (${aq.fieldName})` : "";
      parts.push(`**Q${fieldLabel}**: ${aq.question}`);
      parts.push(`**A**: ${aq.answer}\n`);
    }
  }

  // Reference materials — skip content in RAG mode
  if (!ragEnabled) {
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

  // Build system message with conditional tool instructions
  let systemMessage = ENTITY_CHAT_SYSTEM_MESSAGE;

  if (bigqueryAvailable) {
    systemMessage += `

BIGQUERY DATA ACCESS:
You have access to a \`query_bigquery\` tool for data verification${bigqueryDataset ? ` (dataset: ${bigqueryDataset})` : ""}.
- Always use LIMIT (max 25 rows)
- Write focused queries: select only the columns you need
- Only SELECT/WITH are allowed`;
  }

  if (ragEnabled) {
    systemMessage += `

RETRIEVAL TOOLS:
1. \`search_source_schema\` -- Search source tables/fields by keyword
2. \`get_reference_docs\` -- Retrieve domain docs, business rules
3. \`get_sibling_mappings\` -- Look up field mappings in this entity
4. \`get_mapping_examples\` -- Find examples of similar mappings${bigqueryAvailable ? `\n5. \`query_bigquery\` -- Run read-only SQL queries` : ""}

Call multiple tools in a single turn when possible.`;
  }

  // Add source schema stats in RAG mode
  if (ragEnabled && sourceSchemaStats) {
    const primaryNote = sourceSchemaStats.primarySource
      ? ` Primary source: ${sourceSchemaStats.primarySource}.`
      : "";
    parts.push(`\n## Source Schema`);
    parts.push(
      `${sourceSchemaStats.tableCount} source tables with ${sourceSchemaStats.fieldCount} total fields.${primaryNote} Use \`search_source_schema\` to find relevant fields.`
    );
  }

  return {
    systemMessage,
    contextMessage: parts.join("\n"),
  };
}
