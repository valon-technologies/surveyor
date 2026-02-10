import { z } from "zod/v4";
import {
  MAPPING_STATUSES,
  MAPPING_TYPES,
  CONFIDENCE_LEVELS,
  type MappingStatus,
  type MappingType,
  type ConfidenceLevel,
} from "@/lib/constants";
import type { ParsedFieldMapping, ParseResult } from "@/types/generation";

// --- Lenient Zod schema ---
// LLMs often return values outside our enums ("mapped", "complete", "string_match", etc.)
// Accept any string, then coerce to valid values in post-processing.

const llmMappingSchema = z.object({
  targetFieldName: z.string(),
  status: z.string().optional().default("pending"),
  mappingType: z.string().nullable().optional().default(null),
  sourceEntityName: z.string().nullable().optional().default(null),
  sourceFieldName: z.string().nullable().optional().default(null),
  transform: z.string().nullable().optional().default(null),
  defaultValue: z.string().nullable().optional().default(null),
  enumMapping: z.record(z.string(), z.string()).nullable().optional().default(null),
  reasoning: z.string().nullable().optional().default(null),
  confidence: z.string().nullable().optional().default(null),
  notes: z.string().nullable().optional().default(null),
  reviewComment: z.string().nullable().optional().default(null),
});

const llmOutputSchema = z.array(llmMappingSchema);

/** Map LLM status strings to our valid statuses */
function coerceStatus(raw: string): MappingStatus {
  const lower = raw.toLowerCase().replace(/[\s_-]/g, "");
  // Common LLM variations
  if (lower === "unmapped" || lower === "notmapped" || lower === "none") return "unmapped";
  if (lower === "fullyclosed" || lower === "closed" || lower === "complete" || lower === "completed" || lower === "done") return "fully_closed";
  if (lower === "opencommentsm") return "open_comment_sm";
  if (lower === "opencommentvt") return "open_comment_vt";
  // Check exact match
  if ((MAPPING_STATUSES as readonly string[]).includes(raw)) return raw as MappingStatus;
  // Default: anything that implies "has a mapping" → pending
  return "pending";
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

  // Extract and parse JSON
  const jsonStr = extractJson(rawOutput);
  if (!jsonStr) {
    const preview = rawOutput.slice(0, 200).replace(/\n/g, " ");
    return {
      fieldMappings: [],
      parseErrors: [
        `LLM did not return a JSON array. Response starts with: "${preview}..."`,
      ],
      unmappedFields: ctx.requestedFieldNames,
    };
  }

  let rawMappings: unknown;
  try {
    rawMappings = JSON.parse(jsonStr);
  } catch (e) {
    // If parse fails, try adding a closing ] (truncated output)
    try {
      rawMappings = JSON.parse(jsonStr + "]");
      parseErrors.push("JSON was truncated — closing bracket added automatically");
    } catch {
      // Try trimming the last incomplete object and closing
      const lastComplete = jsonStr.lastIndexOf("}");
      if (lastComplete > 0) {
        try {
          rawMappings = JSON.parse(jsonStr.slice(0, lastComplete + 1) + "]");
          parseErrors.push("JSON was truncated — last incomplete entry dropped");
        } catch {
          const preview = jsonStr.slice(0, 200).replace(/\n/g, " ");
          return {
            fieldMappings: [],
            parseErrors: [
              `JSON parse error: ${e instanceof Error ? e.message : String(e)}. Extracted text starts with: "${preview}..."`,
            ],
            unmappedFields: ctx.requestedFieldNames,
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
        };
      }
    }
  }

  // Validate schema
  const result = llmOutputSchema.safeParse(rawMappings);
  if (!result.success) {
    return {
      fieldMappings: [],
      parseErrors: [`Schema validation failed: ${result.error.message}`],
      unmappedFields: ctx.requestedFieldNames,
    };
  }

  const mappedFieldNames = new Set<string>();

  for (const raw of result.data) {
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
      const candidates = sourceEntityId
        ? ctx.sourceFields.filter((f) => f.entityId === sourceEntityId)
        : ctx.sourceFields;

      const sourceField = candidates.find((f) =>
        matchName(f.name, raw.sourceFieldName!)
      );
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
      confidence,
      notes: raw.notes,
      reviewComment: confidence !== "high" ? (raw.reviewComment || null) : null,
      resolveWarnings,
    });
  }

  // Track unmapped fields
  const unmappedFields = ctx.requestedFieldNames.filter(
    (name) => !mappedFieldNames.has(name.toLowerCase())
  );

  return { fieldMappings, parseErrors, unmappedFields };
}
