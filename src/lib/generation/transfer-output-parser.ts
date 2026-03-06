/**
 * Parse transfer mapping LLM output into structured records.
 */

export interface TransferMappingOutput {
  vds_entity: string;
  vds_field: string;
  has_mapping: boolean;
  source_field: string;
  source_position: number;
  transformation: string;
  confidence: string;
  reasoning: string;
  context_used: string;
  follow_up_question: string;
  /** Set post-parse when a hard override was applied. */
  _corrected?: boolean;
  /** Default/constant value for overrides without a source field. */
  _defaultValue?: string;
}

export interface TransferResolutionContext {
  /** Target VDS fields: entityName.fieldName → fieldId */
  targetFieldIds: Map<string, string>;
  /** Source fields: fieldName → { id, position } */
  sourceFieldIds: Map<string, { id: string; position: number }>;
}

export interface ResolvedTransferMapping {
  targetFieldId: string;
  targetEntity: string;
  targetField: string;
  sourceFieldId: string | null;
  sourceFieldName: string | null;
  sourcePosition: number;
  hasMapping: boolean;
  defaultValue: string | null;
  transformation: string;
  confidence: "high" | "medium" | "low" | null;
  reasoning: string;
  contextUsed: string;
  followUpQuestion: string;
  mappingType: string | null;
  corrected: boolean;
  warnings: string[];
}

/**
 * Parse raw LLM JSON output into TransferMappingOutput[].
 * Handles code fences, truncated output, concatenated arrays.
 */
export function parseTransferResponse(rawOutput: string): TransferMappingOutput[] {
  let text = rawOutput.trim();

  // Strip code fences
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    // Try merging concatenated arrays: ][  → ,
    const combined = text.replace(/\]\s*\[/g, ",");
    try {
      const data = JSON.parse(combined);
      if (Array.isArray(data)) return data;
    } catch {
      // Truncation recovery: find last complete object
      const lastBrace = text.lastIndexOf("}");
      if (lastBrace > 0) {
        try {
          const data = JSON.parse(text.slice(0, lastBrace + 1) + "]");
          if (Array.isArray(data)) return data;
        } catch {
          // Give up
        }
      }
    }
  }
  return [];
}

/**
 * Resolve parsed output into field_mapping-compatible records.
 */
export function resolveTransferMappings(
  outputs: TransferMappingOutput[],
  ctx: TransferResolutionContext,
): ResolvedTransferMapping[] {
  return outputs.map((o) => {
    const warnings: string[] = [];
    const key = `${o.vds_entity}.${o.vds_field}`;

    // Resolve target
    const targetFieldId = ctx.targetFieldIds.get(key);
    if (!targetFieldId) {
      warnings.push(`Target field not found: ${key}`);
    }

    // Resolve source
    let sourceFieldId: string | null = null;
    let sourcePosition = o.source_position ?? -1;
    if (o.has_mapping && o.source_field) {
      const src = ctx.sourceFieldIds.get(o.source_field);
      if (src) {
        sourceFieldId = src.id;
        sourcePosition = src.position;
      } else {
        warnings.push(`Source field not found: "${o.source_field}" (hallucination?)`);
      }
    }

    // Coerce confidence
    const rawConf = (o.confidence || "").toUpperCase();
    const confidence: "high" | "medium" | "low" | null =
      rawConf === "HIGH" ? "high" :
      rawConf === "MEDIUM" ? "medium" :
      rawConf === "LOW" ? "low" : null;

    // Infer mappingType from transformation
    const trans = (o.transformation || "").toLowerCase();
    let mappingType: string | null = null;
    if (o.has_mapping) {
      if (trans.startsWith("identity")) mappingType = "direct";
      else if (trans.startsWith("enum_map") || trans.includes("enum")) mappingType = "enum";
      else if (trans.startsWith("expression") || trans.includes("derive")) mappingType = "derived";
      else if (trans.includes("conditional") || trans.includes("if ")) mappingType = "conditional";
      else mappingType = "direct";
    }

    // Force unmapped if no source resolved and LLM claimed mapping
    // Exception: corrected overrides with default values don't need a source field
    const isDefaultValueOverride = o._corrected && o._defaultValue;
    if (o.has_mapping && !sourceFieldId && !o._corrected) {
      warnings.push("Forced unmapped: source field not resolved");
    }

    return {
      targetFieldId: targetFieldId || "",
      targetEntity: o.vds_entity,
      targetField: o.vds_field,
      sourceFieldId,
      sourceFieldName: o.source_field || null,
      sourcePosition,
      hasMapping: o.has_mapping && (!!sourceFieldId || !!o._corrected || !!isDefaultValueOverride),
      defaultValue: o._defaultValue || null,
      transformation: o.transformation || "",
      confidence,
      reasoning: o.reasoning || "",
      contextUsed: o.context_used || "",
      followUpQuestion: o.follow_up_question || "",
      mappingType,
      corrected: !!o._corrected,
      warnings,
    };
  });
}
