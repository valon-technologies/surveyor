/**
 * Loads pre-parsed SOT (Source of Truth) data from mapping-engine eval JSONs.
 *
 * The eval JSONs already have staging chains resolved — each field has a
 * `sot_sources` array of fully-resolved `Table.Field` references.
 */

import fs from "fs";
import path from "path";

const DEFAULT_EVAL_DIR = "/Users/rob/code/mapping-engine/evaluations/yaml-v7-full-v3";

function getEvalDir(): string {
  return process.env.SOT_EVAL_DIR || DEFAULT_EVAL_DIR;
}

export interface SotFieldData {
  field: string;
  sotSources: string[];       // e.g. ["DefaultWorkstations.ModInfoCapEscrowAmount"]
  sotSummary: string | null;  // human-readable SOT description
}

export interface SotEntityData {
  entityName: string;
  fields: Record<string, SotFieldData>;
}

interface EvalFieldJson {
  field: string;
  source_match: string;
  gen_sources: string[] | null;
  sot_sources: string[] | null;
  transform_match: string;
  transform_similarity: number;
  explanation: string;
  sot_summary: string | null;
  candidate_summary: string | null;
}

interface EvalJson {
  entity: string;
  field_evaluations: Record<string, EvalFieldJson>;
  source_accuracy_pct: number;
  transform_accuracy_pct: number;
  overall_accuracy_pct: number;
}

/**
 * Load SOT data for a specific entity from the eval JSON.
 * Returns null if no eval JSON exists for the entity.
 */
export function loadSotForEntity(entityName: string): SotEntityData | null {
  const evalDir = getEvalDir();
  const filePath = path.join(evalDir, `${entityName}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as EvalJson;

  const fields: Record<string, SotFieldData> = {};
  for (const [fieldName, evalField] of Object.entries(data.field_evaluations)) {
    fields[fieldName] = {
      field: evalField.field,
      sotSources: evalField.sot_sources || [],
      sotSummary: evalField.sot_summary || null,
    };
  }

  return {
    entityName: data.entity,
    fields,
  };
}

/**
 * List all entities that have SOT eval data available.
 */
export function listAvailableSotEntities(): string[] {
  const evalDir = getEvalDir();

  if (!fs.existsSync(evalDir)) {
    return [];
  }

  return fs
    .readdirSync(evalDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}
