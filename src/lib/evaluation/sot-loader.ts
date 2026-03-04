/**
 * Loads SOT (Source of Truth) data for evaluation.
 *
 * Two sources, checked in order:
 * 1. Pre-parsed eval JSONs from mapping-engine (M1 — staging chains already resolved)
 * 2. Raw YAML files from sdt_mapping repo (M1 + M2 — parsed via yaml-parser)
 *
 * The eval JSONs take priority when both exist for the same entity.
 */

import fs from "fs";
import path from "path";
import { loadSotEntity as loadSotYaml, listSotEntities as listYamlEntities } from "@/lib/sot/yaml-parser";

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
 * Load SOT data for a specific entity.
 * Checks eval JSON first (M1, pre-parsed), then raw YAMLs (M1 + M2).
 * Returns null if no SOT data exists for the entity.
 */
export function loadSotForEntity(entityName: string): SotEntityData | null {
  // Strategy 1: Pre-parsed eval JSON (M1 — most accurate, has staging chains resolved)
  const evalDir = getEvalDir();
  const filePath = path.join(evalDir, `${entityName}.json`);

  if (fs.existsSync(filePath)) {
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

    return { entityName: data.entity, fields };
  }

  // Strategy 2: Raw YAML files (M1 + M2 — parsed via yaml-parser)
  // Try M2 first (more likely to have new entities), then M1
  for (const milestone of ["m2", "m1"] as const) {
    const yamlData = loadSotYaml(entityName, milestone);
    if (yamlData) {
      const fields: Record<string, SotFieldData> = {};
      for (const col of yamlData.columns) {
        fields[col.targetColumn] = {
          field: col.targetColumn,
          sotSources: [...col.resolvedSources],
          sotSummary: col.expression
            ? `transform: ${col.transform} | expression: ${col.expression.slice(0, 200)}`
            : col.transform
              ? `transform: ${col.transform}`
              : null,
        };
      }

      // For assembly parents: merge staging component ACDC sources into parent fields.
      // Parent columns have bare source refs (e.g., `source: first_name`) that don't resolve
      // to ACDC table.column format. The real ACDC sources live in staging components.
      if (yamlData.stagingDetail) {
        for (const comp of yamlData.stagingDetail) {
          for (const compCol of comp.columns) {
            const parentField = fields[compCol.targetColumn];
            if (parentField) {
              for (const src of compCol.resolvedSources) {
                if (!parentField.sotSources.includes(src)) {
                  parentField.sotSources.push(src);
                }
              }
            }
          }
        }
      }

      return { entityName: yamlData.table, fields };
    }
  }

  return null;
}

/**
 * List all entities that have SOT eval data available (eval JSONs + raw YAMLs).
 */
export function listAvailableSotEntities(): string[] {
  const names = new Set<string>();

  // From eval JSON dir (M1)
  const evalDir = getEvalDir();
  if (fs.existsSync(evalDir)) {
    for (const f of fs.readdirSync(evalDir)) {
      if (f.endsWith(".json")) {
        names.add(f.replace(".json", ""));
      }
    }
  }

  // From YAML dirs (M1 + M2)
  for (const summary of listYamlEntities()) {
    names.add(summary.name);
  }

  return [...names].sort();
}
