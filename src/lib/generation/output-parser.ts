import { z } from "zod/v4";
import yaml from "js-yaml";
import {
  MAPPING_STATUSES,
  MAPPING_TYPES,
  CONFIDENCE_LEVELS,
  UNCERTAINTY_TYPES,
  type MappingStatus,
  type MappingType,
  type ConfidenceLevel,
  type UncertaintyType,
} from "@/lib/constants";
import type { ParsedFieldMapping, ParsedQuestion, ParseResult } from "@/types/generation";

// --- Lenient Zod schema ---
// LLMs often return values outside our enums ("mapped", "complete", "string_match", etc.)
// Accept any string, then coerce to valid values in post-processing.

const llmMappingSchema = z.object({
  targetFieldName: z.string(),
  status: z.string().optional().default("unreviewed"),
  mappingType: z.string().nullable().optional().default(null),
  sourceEntityName: z.string().nullable().optional().default(null),
  sourceFieldName: z.string().nullable().optional().default(null),
  transform: z.string().nullable().optional().default(null),
  defaultValue: z.string().nullable().optional().default(null),
  enumMapping: z.record(z.string(), z.string().nullable()).nullable().optional().default(null),
  reasoning: z.string().nullable().optional().default(null),
  confidence: z.string().nullable().optional().default(null),
  uncertaintyType: z.string().nullable().optional().default(null),
  notes: z.string().nullable().optional().default(null),
  reviewComment: z.string().nullable().optional().default(null),
});

const llmOutputSchema = z.array(llmMappingSchema);

const llmQuestionSchema = z.object({
  targetFieldName: z.string().nullable().optional().default(null),
  questionText: z.string(),
  questionType: z.string().optional().default("missing_context"),
  priority: z.string().optional().default("normal"),
});

const llmWrapperSchema = z.object({
  mappings: z.array(llmMappingSchema),
  questions: z.array(llmQuestionSchema).optional().default([]),
});

/** Map LLM status strings to our valid statuses */
function coerceStatus(raw: string): MappingStatus {
  const lower = raw.toLowerCase().replace(/[\s_-]/g, "");
  // Common LLM variations
  if (lower === "unmapped" || lower === "notmapped" || lower === "none") return "unmapped";
  if (lower === "excluded") return "excluded";
  if (lower === "accepted" || lower === "fullyclosed" || lower === "closed" || lower === "complete" || lower === "completed" || lower === "done") return "accepted";
  // Check exact match
  if ((MAPPING_STATUSES as readonly string[]).includes(raw)) return raw as MappingStatus;
  // Default: anything that implies "has a mapping" → unreviewed
  return "unreviewed";
}

/** Map LLM mapping type strings to our valid types */
function coerceMappingType(raw: string | null): MappingType | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[\s-]/g, "_");
  if ((MAPPING_TYPES as readonly string[]).includes(lower)) return lower as MappingType;
  // Common LLM variations
  if (lower === "direct_mapping" || lower === "one_to_one" || lower === "1to1") return "direct";
  if (lower === "transformation" || lower === "transform") return "derived";
  if (lower === "lookup" || lower === "reference") return "join";
  if (lower === "enum_mapping" || lower === "enumeration") return "enum";
  if (lower === "cast" || lower === "typecast" || lower === "type_conversion") return "type_cast";
  return null;
}

/** Map LLM confidence strings to our valid levels */
function coerceConfidence(raw: string | null): ConfidenceLevel | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "high" || lower === "certain" || lower === "definite") return "high";
  if (lower === "medium" || lower === "moderate" || lower === "likely") return "medium";
  if (lower === "low" || lower === "uncertain" || lower === "unsure" || lower === "unknown") return "low";
  if ((CONFIDENCE_LEVELS as readonly string[]).includes(raw)) return raw as ConfidenceLevel;
  return null;
}

/** Map LLM uncertainty type strings to our valid types */
function coerceUncertaintyType(raw: string | null): UncertaintyType | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[\s-]/g, "_");
  if ((UNCERTAINTY_TYPES as readonly string[]).includes(lower)) return lower as UncertaintyType;
  // Common LLM variations
  if (lower.includes("no_match") || lower.includes("not_found") || lower.includes("no_source")) return "no_source_match";
  if (lower.includes("multiple") || lower.includes("ambiguous_source") || lower.includes("candidates")) return "multiple_candidates";
  if (lower.includes("transform") || lower.includes("conversion") || lower.includes("logic")) return "unclear_transform";
  if (lower.includes("enum") || lower.includes("incomplete") || lower.includes("values")) return "incomplete_enum";
  if (lower.includes("domain") || lower.includes("business") || lower.includes("ambig")) return "domain_ambiguity";
  if (lower.includes("context") || lower.includes("missing") || lower.includes("documentation")) return "missing_context";
  return "missing_context"; // safe default
}

/** Map LLM priority strings to valid priority enum */
function coerceQuestionPriority(raw: string): "urgent" | "high" | "normal" | "low" {
  const lower = raw.toLowerCase();
  if (lower === "urgent" || lower === "critical") return "urgent";
  if (lower === "high" || lower === "important") return "high";
  if (lower === "normal" || lower === "medium" || lower === "moderate") return "normal";
  if (lower === "low" || lower === "minor") return "low";
  return "normal";
}

/** Infer uncertainty type from reviewComment text when LLM omits it */
function inferUncertaintyType(reviewComment: string | null, fm: { sourceFieldName: string | null; confidence: string | null }): UncertaintyType | null {
  if (!reviewComment) return null;
  const lower = reviewComment.toLowerCase();
  if (!fm.sourceFieldName || lower.includes("no source") || lower.includes("not found") || lower.includes("no matching")) return "no_source_match";
  if (lower.includes("multiple") || lower.includes("could be") || lower.includes("either")) return "multiple_candidates";
  if (lower.includes("enum") || lower.includes("code") || lower.includes("values")) return "incomplete_enum";
  if (lower.includes("transform") || lower.includes("conversion") || lower.includes("logic")) return "unclear_transform";
  if (lower.includes("business") || lower.includes("domain") || lower.includes("meaning")) return "domain_ambiguity";
  return "missing_context";
}

interface FieldRef {
  id: string;
  name: string;
  entityId: string;
}

interface EntityRef {
  id: string;
  name: string;
}

interface ResolutionContext {
  targetFields: FieldRef[];
  sourceEntities: EntityRef[];
  sourceFields: FieldRef[];
  requestedFieldNames: string[];
}

/**
 * Extract JSON array from LLM output that may be wrapped in code fences,
 * preceded by conversational text, or otherwise mangled.
 * Returns null if no JSON array can be found.
 */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();

  // 1. If it already starts with '[', take it as-is
  if (trimmed.startsWith("[")) {
    return trimmed;
  }

  // 2. Try to find JSON in code fences
  const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g)];
  for (const m of fenceMatches) {
    const candidate = m[1].trim();
    if (candidate.startsWith("[")) return candidate;
  }

  // 3. Handle opening code fence WITHOUT closing ``` (truncated output or LLM forgot)
  const openFence = trimmed.match(/```(?:json)?\s*\n?([\s\S]+)/);
  if (openFence) {
    const afterFence = openFence[1].trim();
    // Strip trailing ``` if it's there but wasn't caught above
    const stripped = afterFence.replace(/\s*```\s*$/, "").trim();
    if (stripped.startsWith("[")) {
      return stripped;
    }
  }

  // 4. Find the first '[' and use string-aware bracket balancing
  const startIdx = trimmed.indexOf("[");
  if (startIdx === -1) return null;

  const balanced = balanceBrackets(trimmed, startIdx);
  if (balanced) return balanced;

  // 5. Last resort: take everything from the first '[' to the end
  const remainder = trimmed.slice(startIdx).trim();
  if (remainder.startsWith("[")) return remainder;

  return null;
}

/**
 * String-aware bracket balancing: skips [ and ] inside JSON string values.
 */
function balanceBrackets(text: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let endIdx = -1;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (endIdx !== -1) {
    return text.slice(startIdx, endIdx + 1);
  }

  return null;
}

/**
 * Extract JSON object from LLM output (wrapper format: {"mappings":..., "questions":...}).
 * Returns null if no JSON object can be found.
 */
function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();

  // 1. If it already starts with '{', take it as-is
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  // 2. Try to find JSON in code fences
  const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g)];
  for (const m of fenceMatches) {
    const candidate = m[1].trim();
    if (candidate.startsWith("{")) return candidate;
  }

  // 3. Handle opening code fence WITHOUT closing
  const openFence = trimmed.match(/```(?:json)?\s*\n?([\s\S]+)/);
  if (openFence) {
    const afterFence = openFence[1].trim();
    const stripped = afterFence.replace(/\s*```\s*$/, "").trim();
    if (stripped.startsWith("{")) return stripped;
  }

  // 4. Find the first '{' and use string-aware brace balancing
  const startIdx = trimmed.indexOf("{");
  if (startIdx === -1) return null;

  const balanced = balanceBraces(trimmed, startIdx);
  if (balanced) return balanced;

  // 5. Last resort: take everything from the first '{' to the end
  const remainder = trimmed.slice(startIdx).trim();
  if (remainder.startsWith("{")) return remainder;

  return null;
}

/**
 * String-aware brace balancing: skips { and } inside JSON string values.
 */
function balanceBraces(text: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let endIdx = -1;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (endIdx !== -1) {
    return text.slice(startIdx, endIdx + 1);
  }

  return null;
}

/**
 * Case-insensitive name matching with normalization.
 */
function matchName(a: string, b: string): boolean {
  return a.toLowerCase().replace(/[_\s-]/g, "") === b.toLowerCase().replace(/[_\s-]/g, "");
}

/**
 * Parse raw LLM output into structured ParseResult.
 * Resolves names to IDs using the provided context.
 */
export function parseGenerationOutput(
  rawOutput: string,
  ctx: ResolutionContext
): ParseResult {
  const parseErrors: string[] = [];
  const fieldMappings: ParsedFieldMapping[] = [];
  const questions: ParsedQuestion[] = [];

  // Try wrapper format first: {"mappings": [...], "questions": [...]}
  let rawMappings: unknown[] | null = null;
  let rawQuestions: unknown[] | null = null;

  const jsonObjStr = extractJsonObject(rawOutput);
  if (jsonObjStr) {
    try {
      const parsed = JSON.parse(jsonObjStr);
      const wrapperResult = llmWrapperSchema.safeParse(parsed);
      if (wrapperResult.success) {
        rawMappings = wrapperResult.data.mappings;
        rawQuestions = wrapperResult.data.questions;
      }
    } catch {
      // Not valid wrapper JSON — fall through to array format
    }
  }

  // Fall back to old array format: [...]
  if (!rawMappings) {
    const jsonStr = extractJson(rawOutput);
    if (!jsonStr) {
      const preview = rawOutput.slice(0, 200).replace(/\n/g, " ");
      return {
        fieldMappings: [],
        parseErrors: [
          `LLM did not return valid JSON. Response starts with: "${preview}..."`,
        ],
        unmappedFields: ctx.requestedFieldNames,
        questions: [],
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      // If parse fails, try adding a closing ] (truncated output)
      try {
        parsed = JSON.parse(jsonStr + "]");
        parseErrors.push("JSON was truncated — closing bracket added automatically");
      } catch {
        // Try trimming the last incomplete object and closing
        const lastComplete = jsonStr.lastIndexOf("}");
        if (lastComplete > 0) {
          try {
            parsed = JSON.parse(jsonStr.slice(0, lastComplete + 1) + "]");
            parseErrors.push("JSON was truncated — last incomplete entry dropped");
          } catch {
            const preview = jsonStr.slice(0, 200).replace(/\n/g, " ");
            return {
              fieldMappings: [],
              parseErrors: [
                `JSON parse error: ${e instanceof Error ? e.message : String(e)}. Extracted text starts with: "${preview}..."`,
              ],
              unmappedFields: ctx.requestedFieldNames,
              questions: [],
            };
          }
        } else {
          const preview = jsonStr.slice(0, 200).replace(/\n/g, " ");
          return {
            fieldMappings: [],
            parseErrors: [
              `JSON parse error: ${e instanceof Error ? e.message : String(e)}. Extracted text starts with: "${preview}..."`,
            ],
            unmappedFields: ctx.requestedFieldNames,
            questions: [],
          };
        }
      }
    }

    // Validate as array schema
    const result = llmOutputSchema.safeParse(parsed);
    if (!result.success) {
      return {
        fieldMappings: [],
        parseErrors: [`Schema validation failed: ${result.error.message}`],
        unmappedFields: ctx.requestedFieldNames,
        questions: [],
      };
    }
    rawMappings = result.data;
  }

  // Process mappings
  const mappedFieldNames = new Set<string>();

  for (const raw of rawMappings as z.infer<typeof llmMappingSchema>[]) {
    const resolveWarnings: string[] = [];

    // Resolve target field
    const targetField = ctx.targetFields.find((f) =>
      matchName(f.name, raw.targetFieldName)
    );
    if (!targetField) {
      parseErrors.push(`Unknown target field: "${raw.targetFieldName}"`);
      continue;
    }

    mappedFieldNames.add(raw.targetFieldName.toLowerCase());

    // Coerce LLM values to valid enums
    const status = coerceStatus(raw.status);
    const mappingType = coerceMappingType(raw.mappingType);
    const confidence = coerceConfidence(raw.confidence);

    // Resolve source entity
    let sourceEntityId: string | null = null;
    if (raw.sourceEntityName) {
      const sourceEntity = ctx.sourceEntities.find((e) =>
        matchName(e.name, raw.sourceEntityName!)
      );
      if (sourceEntity) {
        sourceEntityId = sourceEntity.id;
      } else {
        resolveWarnings.push(
          `Source entity "${raw.sourceEntityName}" not found in schema`
        );
      }
    }

    // Resolve source field
    let sourceFieldId: string | null = null;
    if (raw.sourceFieldName) {
      // Try entity-scoped search first, then fall back to all source fields
      const scopedCandidates = sourceEntityId
        ? ctx.sourceFields.filter((f) => f.entityId === sourceEntityId)
        : ctx.sourceFields;

      let sourceField = scopedCandidates.find((f) =>
        matchName(f.name, raw.sourceFieldName!)
      );
      // Fallback: if scoped search failed but we have more fields to search, try all
      if (!sourceField && sourceEntityId) {
        sourceField = ctx.sourceFields.find((f) =>
          matchName(f.name, raw.sourceFieldName!)
        );
        if (sourceField) {
          sourceEntityId = sourceField.entityId;
          resolveWarnings.push(
            `Source field "${raw.sourceFieldName}" found in different entity than LLM suggested`
          );
        }
      }
      if (sourceField) {
        sourceFieldId = sourceField.id;
        if (!sourceEntityId) {
          sourceEntityId = sourceField.entityId;
        }
      } else {
        resolveWarnings.push(
          `Source field "${raw.sourceFieldName}" not found${sourceEntityId ? " in resolved entity" : ""}`
        );
      }
    }

    // Downgrade hallucinated source fields: if the LLM proposed a source field
    // that doesn't exist in the schema, force low confidence with explanation
    const hallucinated = raw.sourceFieldName && !sourceFieldId;
    const finalConfidence = hallucinated ? "low" as ConfidenceLevel : confidence;
    const finalReviewComment = hallucinated
      ? `Source field "${raw.sourceFieldName}" was not found in the available schema. This may be a hallucinated field name — please verify manually.`
      : (confidence !== "high" ? (raw.reviewComment || null) : null);

    // Coerce uncertainty type — use LLM value, fall back to inference from reviewComment
    const rawUncertainty = coerceUncertaintyType(raw.uncertaintyType);
    const finalUncertaintyType = rawUncertainty
      ?? (finalConfidence !== "high" ? inferUncertaintyType(finalReviewComment, raw) : null);

    fieldMappings.push({
      targetFieldName: raw.targetFieldName,
      targetFieldId: targetField.id,
      status,
      mappingType,
      sourceEntityName: raw.sourceEntityName,
      sourceEntityId,
      sourceFieldName: raw.sourceFieldName,
      sourceFieldId,
      transform: raw.transform,
      defaultValue: raw.defaultValue,
      enumMapping: raw.enumMapping,
      reasoning: raw.reasoning,
      confidence: finalConfidence,
      notes: raw.notes,
      reviewComment: finalReviewComment,
      uncertaintyType: finalUncertaintyType,
      resolveWarnings,
    });
  }

  // Process questions
  if (rawQuestions && rawQuestions.length > 0) {
    for (const rawQ of rawQuestions as z.infer<typeof llmQuestionSchema>[]) {
      // Resolve target field ID if targetFieldName is provided
      let targetFieldId: string | null = null;
      if (rawQ.targetFieldName) {
        const targetField = ctx.targetFields.find((f) =>
          matchName(f.name, rawQ.targetFieldName!)
        );
        if (targetField) {
          targetFieldId = targetField.id;
        }
      }

      questions.push({
        targetFieldName: rawQ.targetFieldName,
        targetFieldId,
        questionText: rawQ.questionText,
        questionType: coerceUncertaintyType(rawQ.questionType) ?? "missing_context",
        priority: coerceQuestionPriority(rawQ.priority),
      });
    }
  }

  // Track unmapped fields
  const unmappedFields = ctx.requestedFieldNames.filter(
    (name) => !mappedFieldNames.has(name.toLowerCase())
  );

  return { fieldMappings, parseErrors, unmappedFields, questions };
}


// ── YAML output parsing ──

/** Zod schema for validating YAML mapping output */
const yamlColumnSchema = z.object({
  target_column: z.string(),
  source: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullable().optional(),
  expression: z.string().nullable().optional(),
  transform: z.string().nullable().optional(),
  hash_columns: z.array(z.string()).nullable().optional(),
  dtype: z.string().nullable().optional(),
});

const yamlSourceSchema = z.object({
  name: z.string(),
  alias: z.string(),
  pipe_file: z.object({ table: z.string() }).nullable().optional(),
  staging: z.object({ table: z.string() }).nullable().optional(),
  filters: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
});

const yamlQuestionSchema = z.object({
  target_column: z.string().nullable().optional().default(null),
  question: z.string(),
  question_type: z.string().optional().default("missing_context"),
  priority: z.string().optional().default("normal"),
});

const yamlMappingSchema = z.object({
  table: z.string(),
  version: z.number().optional().default(1),
  primary_key: z.array(z.string()).nullable().optional(),
  sources: z.array(yamlSourceSchema),
  joins: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  concat: z.record(z.string(), z.unknown()).nullable().optional(),
  columns: z.array(yamlColumnSchema),
  questions: z.array(yamlQuestionSchema).nullable().optional(),
});

export interface YamlParseResult extends ParseResult {
  /** The raw YAML text (for storage/export) */
  yamlOutput: string;
  /** Structured parsed YAML (for programmatic access) */
  yamlParsed: z.infer<typeof yamlMappingSchema> | null;
}

/**
 * Extract YAML from LLM output that may have code fences or preamble text.
 */
function extractYaml(raw: string): string {
  const trimmed = raw.trim();

  // 1. Check for code fences
  const fenceMatch = trimmed.match(/```(?:ya?ml)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // 2. Handle open fence without closing
  const openFence = trimmed.match(/```(?:ya?ml)?\s*\n?([\s\S]+)/);
  if (openFence) {
    return openFence[1].replace(/\s*```\s*$/, "").trim();
  }

  // 3. If it starts with "table:" it's likely raw YAML
  if (trimmed.startsWith("table:")) {
    return trimmed;
  }

  // 4. Find first "table:" line and take everything from there
  const tableIdx = trimmed.indexOf("\ntable:");
  if (tableIdx !== -1) {
    return trimmed.slice(tableIdx + 1).trim();
  }

  // 5. Return as-is and let the YAML parser handle errors
  return trimmed;
}

/**
 * Map YAML transform type to our MappingType enum.
 */
function yamlTransformToMappingType(transform: string | null | undefined, col: z.infer<typeof yamlColumnSchema>): MappingType | null {
  if (!transform) return null;
  const lower = transform.toLowerCase();
  if (lower === "identity") return "direct";
  if (lower === "expression") {
    // Check if expression contains .map() → enum
    if (col.expression && col.expression.includes(".map(")) return "enum";
    return "derived";
  }
  if (lower === "literal") return "direct";
  if (lower === "hash_id") return "derived";
  if (lower === "null") return null;
  return null;
}

/**
 * Extract source entity and field from a YAML source reference.
 * E.g., "pf.PfFieldName" → { alias: "pf", field: "PfFieldName" }
 */
function parseYamlSource(source: unknown): { alias: string; field: string } | null {
  if (typeof source !== "string") return null;
  if (!source || source === "[]") return null;
  const dotIdx = source.indexOf(".");
  if (dotIdx === -1) return { alias: "", field: source };
  return { alias: source.slice(0, dotIdx), field: source.slice(dotIdx + 1) };
}

/**
 * Parse YAML mapping output into structured ParseResult + raw YAML.
 * Converts YAML columns to ParsedFieldMapping[] for DB compatibility.
 */
export function parseYamlOutput(
  rawOutput: string,
  ctx: ResolutionContext,
): YamlParseResult {
  const parseErrors: string[] = [];
  const fieldMappings: ParsedFieldMapping[] = [];
  const questions: ParsedQuestion[] = [];

  // Extract YAML
  const yamlStr = extractYaml(rawOutput);

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlStr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      fieldMappings: [],
      parseErrors: [`YAML parse error: ${msg}`],
      unmappedFields: ctx.requestedFieldNames,
      questions: [],
      yamlOutput: yamlStr,
      yamlParsed: null,
    };
  }

  // Validate schema
  const result = yamlMappingSchema.safeParse(parsed);
  if (!result.success) {
    return {
      fieldMappings: [],
      parseErrors: [`YAML schema validation failed: ${result.error.message}`],
      unmappedFields: ctx.requestedFieldNames,
      questions: [],
      yamlOutput: yamlStr,
      yamlParsed: null,
    };
  }

  const yamlMapping = result.data;

  // Build alias → source entity name lookup from the YAML sources
  const aliasToEntity: Map<string, string> = new Map();
  for (const src of yamlMapping.sources) {
    const tableName = src.pipe_file?.table ?? src.staging?.table ?? src.name;
    aliasToEntity.set(src.alias, tableName);
  }

  const mappedFieldNames = new Set<string>();

  for (const col of yamlMapping.columns) {
    const resolveWarnings: string[] = [];

    // Resolve target field
    const targetField = ctx.targetFields.find((f) =>
      matchName(f.name, col.target_column)
    );
    if (!targetField) {
      parseErrors.push(`Unknown target field in YAML: "${col.target_column}"`);
      continue;
    }

    mappedFieldNames.add(col.target_column.toLowerCase());

    // Determine transform type
    const transformStr = col.transform?.toLowerCase() ?? null;
    const isNull = transformStr === "null" || (Array.isArray(col.source) && col.source.length === 0);

    // Status
    const status: MappingStatus = isNull ? "unmapped" : "unreviewed";
    const mappingType = isNull ? null : yamlTransformToMappingType(transformStr, col);

    // Resolve source entity and field
    let sourceEntityName: string | null = null;
    let sourceEntityId: string | null = null;
    let sourceFieldName: string | null = null;
    let sourceFieldId: string | null = null;

    if (!isNull) {
      const ref = parseYamlSource(col.source);
      if (ref) {
        sourceFieldName = ref.field;
        // Resolve entity from alias
        if (ref.alias) {
          sourceEntityName = aliasToEntity.get(ref.alias) ?? null;
        }

        // Resolve IDs
        if (sourceEntityName) {
          const sourceEntity = ctx.sourceEntities.find((e) =>
            matchName(e.name, sourceEntityName!)
          );
          if (sourceEntity) {
            sourceEntityId = sourceEntity.id;
          } else {
            resolveWarnings.push(`Source entity "${sourceEntityName}" not found in schema`);
          }
        }

        if (sourceFieldName) {
          // Try entity-scoped search first, then fall back to all source fields
          const scopedCandidates = sourceEntityId
            ? ctx.sourceFields.filter((f) => f.entityId === sourceEntityId)
            : ctx.sourceFields;
          let sourceField = scopedCandidates.find((f) =>
            matchName(f.name, sourceFieldName!)
          );
          // Fallback: if scoped search failed but we have more fields to search, try all
          if (!sourceField && sourceEntityId) {
            sourceField = ctx.sourceFields.find((f) =>
              matchName(f.name, sourceFieldName!)
            );
            if (sourceField) {
              // Field exists in a different source entity — fix the entity reference
              sourceEntityId = sourceField.entityId;
              resolveWarnings.push(
                `Source field "${sourceFieldName}" found in different entity than alias suggested`
              );
            }
          }
          if (sourceField) {
            sourceFieldId = sourceField.id;
            if (!sourceEntityId) sourceEntityId = sourceField.entityId;
          } else {
            resolveWarnings.push(`Source field "${sourceFieldName}" not found`);
          }
        }
      }
    }

    // Build transform expression for DB storage
    let transform: string | null = null;
    if (col.expression) {
      transform = col.expression.trim();
    }

    // Handle literal source
    let defaultValue: string | null = null;
    if (transformStr === "literal" && typeof col.source === "object" && col.source && !Array.isArray(col.source)) {
      const literal = (col.source as Record<string, unknown>).literal;
      if (literal !== undefined) {
        defaultValue = String(literal);
      }
    }

    // Extract enum mapping from expression if present
    let enumMapping: Record<string, string> | null = null;
    if (col.expression && col.expression.includes(".map(")) {
      const mapMatch = col.expression.match(/\.map\(\s*\{([^}]+)\}/);
      if (mapMatch) {
        try {
          // Try to parse as JSON-like dict (Python dicts use single quotes, need conversion)
          const dictStr = `{${mapMatch[1].replace(/'/g, '"')}}`;
          enumMapping = JSON.parse(dictStr);
        } catch {
          // Leave as null, the expression itself captures the mapping
        }
      }
    }

    // Hallucination check
    const hallucinated = sourceFieldName && !sourceFieldId;
    const yamlConfidence = coerceConfidence(((col as Record<string, unknown>).confidence as string | null) ?? null);
    const confidence: ConfidenceLevel = hallucinated ? "low" : (yamlConfidence || (isNull ? "low" : "high"));
    const yamlReviewComment = ((col as Record<string, unknown>).review_comment as string | null) ?? null;
    const reviewComment = hallucinated
      ? `Source field "${sourceFieldName}" was not found in the available schema. This may be a hallucinated field name.`
      : yamlReviewComment;

    // Infer uncertainty type for non-high confidence YAML mappings
    const uncertaintyType = confidence !== "high"
      ? inferUncertaintyType(reviewComment, { sourceFieldName, confidence })
      : null;

    // Preserve Claude's reasoning from the YAML note field
    const yamlNote = ((col as Record<string, unknown>).note as string | null) ?? null;
    const reasoning = yamlNote
      || (col.expression ? `Transform: ${col.expression.trim().slice(0, 100)}` : (sourceFieldName ? `Direct mapping from ${sourceEntityName}.${sourceFieldName}` : "No source match"));

    fieldMappings.push({
      targetFieldName: col.target_column,
      targetFieldId: targetField.id,
      status,
      mappingType,
      sourceEntityName,
      sourceEntityId,
      sourceFieldName,
      sourceFieldId,
      transform,
      defaultValue,
      enumMapping,
      reasoning,
      confidence,
      notes: null,
      reviewComment,
      uncertaintyType,
      resolveWarnings,
    });
  }

  // Process YAML questions section
  if (yamlMapping.questions && yamlMapping.questions.length > 0) {
    for (const rawQ of yamlMapping.questions) {
      let targetFieldId: string | null = null;
      const targetFieldName = rawQ.target_column ?? null;
      if (targetFieldName) {
        const targetField = ctx.targetFields.find((f) =>
          matchName(f.name, targetFieldName)
        );
        if (targetField) {
          targetFieldId = targetField.id;
        }
      }

      questions.push({
        targetFieldName,
        targetFieldId,
        questionText: rawQ.question,
        questionType: coerceUncertaintyType(rawQ.question_type) ?? "missing_context",
        priority: coerceQuestionPriority(rawQ.priority),
      });
    }
  }

  const unmappedFields = ctx.requestedFieldNames.filter(
    (name) => !mappedFieldNames.has(name.toLowerCase())
  );

  return {
    fieldMappings,
    parseErrors,
    unmappedFields,
    questions,
    yamlOutput: yamlStr,
    yamlParsed: yamlMapping,
  };
}
