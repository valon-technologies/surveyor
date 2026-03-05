/**
 * Load and apply transfer corrections during generation.
 */

import { db } from "@/lib/db";
import { transferCorrection } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { TransferMappingOutput } from "@/lib/generation/transfer-output-parser";

export interface CorrectionRecord {
  id: string;
  type: "hard_override" | "prompt_injection";
  targetEntity: string;
  targetField: string | null;
  appliesTo: string[] | null;
  hasMapping: boolean | null;
  sourceFieldName: string | null;
  sourceFieldPosition: number | null;
  transformation: string | null;
  confidence: string | null;
  reasoning: string | null;
  note: string | null;
}

export interface LoadedCorrections {
  /** Hard overrides keyed by "entity.field" */
  hardOverrides: Map<string, CorrectionRecord>;
  /** Prompt injections keyed by target entity */
  promptInjections: Map<string, CorrectionRecord[]>;
  totalOverrides: number;
  totalInjections: number;
}

/**
 * Load all corrections for a transfer from the DB.
 */
export async function loadCorrections(transferId: string): Promise<LoadedCorrections> {
  const rows = await db
    .select()
    .from(transferCorrection)
    .where(eq(transferCorrection.transferId, transferId));

  const hardOverrides = new Map<string, CorrectionRecord>();
  const promptInjections = new Map<string, CorrectionRecord[]>();

  for (const r of rows) {
    const rec: CorrectionRecord = {
      id: r.id,
      type: r.type as "hard_override" | "prompt_injection",
      targetEntity: r.targetEntity,
      targetField: r.targetField,
      appliesTo: r.appliesTo as string[] | null,
      hasMapping: r.hasMapping,
      sourceFieldName: r.sourceFieldName,
      sourceFieldPosition: r.sourceFieldPosition,
      transformation: r.transformation,
      confidence: r.confidence,
      reasoning: r.reasoning,
      note: r.note,
    };

    if (rec.type === "hard_override" && rec.targetField) {
      hardOverrides.set(`${rec.targetEntity}.${rec.targetField}`, rec);
    } else if (rec.type === "prompt_injection") {
      // Index by each target entity in appliesTo
      const entities = new Set<string>();
      if (rec.appliesTo) {
        for (const t of rec.appliesTo) {
          entities.add(t.split(".")[0]);
        }
      }
      if (rec.targetEntity) entities.add(rec.targetEntity);
      for (const e of entities) {
        const existing = promptInjections.get(e) || [];
        existing.push(rec);
        promptInjections.set(e, existing);
      }
    }
  }

  return {
    hardOverrides,
    promptInjections,
    totalOverrides: hardOverrides.size,
    totalInjections: rows.filter(r => r.type === "prompt_injection").length,
  };
}

/**
 * Build prompt-injection text for a set of entity names.
 * Returns markdown to inject into the prompt.
 */
export function buildCorrectionsContext(
  injections: Map<string, CorrectionRecord[]>,
  entityNames: string[],
): string {
  const entitySet = new Set(entityNames);
  const relevant: string[] = [];

  for (const [entity, recs] of injections.entries()) {
    if (!entitySet.has(entity)) continue;
    for (const rec of recs) {
      const targets = rec.appliesTo?.join(", ") || `${rec.targetEntity}.${rec.targetField || "*"}`;
      relevant.push(`- **${targets}**: ${rec.note}`);
    }
  }

  return relevant.length > 0 ? relevant.join("\n") : "";
}

/**
 * Apply hard overrides to LLM output. Returns modified array.
 * Overridden entries are marked with _corrected=true.
 */
export function applyHardOverrides(
  mappings: TransferMappingOutput[],
  overrides: Map<string, CorrectionRecord>,
): { mappings: TransferMappingOutput[]; applied: number } {
  if (overrides.size === 0) return { mappings, applied: 0 };

  let applied = 0;
  const result: TransferMappingOutput[] = [];

  for (const m of mappings) {
    const key = `${m.vds_entity}.${m.vds_field}`;
    const override = overrides.get(key);
    if (override) {
      result.push({
        vds_entity: m.vds_entity,
        vds_field: m.vds_field,
        has_mapping: override.hasMapping ?? false,
        source_field: override.sourceFieldName || "",
        source_position: override.sourceFieldPosition ?? -1,
        transformation: override.transformation || "",
        confidence: override.confidence || "",
        reasoning: override.reasoning || "",
        context_used: "Human-reviewed correction",
        follow_up_question: "",
        _corrected: true,
      });
      applied++;
    } else {
      result.push(m);
    }
  }

  return { mappings: result, applied };
}

/**
 * Generate synthetic output for hard-override fields that the LLM
 * didn't produce (because they were excluded from the prompt).
 */
export function generateOverrideOutputs(
  overrides: Map<string, CorrectionRecord>,
  entityNames: string[],
): TransferMappingOutput[] {
  const entitySet = new Set(entityNames);
  const result: TransferMappingOutput[] = [];

  for (const [key, override] of overrides.entries()) {
    if (!entitySet.has(override.targetEntity)) continue;
    result.push({
      vds_entity: override.targetEntity,
      vds_field: override.targetField || "",
      has_mapping: override.hasMapping ?? false,
      source_field: override.sourceFieldName || "",
      source_position: override.sourceFieldPosition ?? -1,
      transformation: override.transformation || "",
      confidence: override.confidence || "",
      reasoning: override.reasoning || `Human override: ${override.note || ""}`,
      context_used: "Human-reviewed correction",
      follow_up_question: "",
      _corrected: true,
    });
  }

  return result;
}
