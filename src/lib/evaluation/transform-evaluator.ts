/**
 * Transform evaluator — uses Opus to compare generated transform logic
 * against SOT (Source of Truth) YAML mappings.
 *
 * Ported from mapping-engine's transform_evaluator.py:_build_eval_prompt().
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

// ─── Types ──────────────────────────────────────────────────

export type TransformMatchType = "MATCH" | "PARTIAL" | "WRONG" | "N/A";

export interface TransformFieldResult {
  field: string;
  transformMatch: TransformMatchType;
  transformSimilarity: number;
  explanation: string;
  sotSummary: string;
  candidateSummary: string;
}

export interface GenMappingInput {
  targetField: string;
  sourceEntity: string;
  sourceField: string;
  transform: string | null;
  mappingType: string;
}

// ─── SOT YAML Chain Loader ──────────────────────────────────

const SOT_DIRS = [
  path.resolve("data/sot/m2_mappings"),
  path.resolve("data/sot/m1_mappings"),
];

/**
 * Load the full SOT YAML chain for an entity — the VDS-level YAML plus
 * any staging component YAMLs it references. Returns concatenated text
 * suitable for the Opus eval prompt.
 */
export function loadSotYamlChain(entityName: string): string | null {
  for (const dir of SOT_DIRS) {
    const filePath = path.join(dir, `${entityName}.yaml`);
    if (!fs.existsSync(filePath)) continue;

    const vdsYaml = fs.readFileSync(filePath, "utf-8");
    const parts = [`=== VDS Entity: ${entityName} ===\n${vdsYaml}`];

    // Parse to find staging references
    try {
      const parsed = yaml.load(vdsYaml) as Record<string, unknown>;
      const sources = (parsed?.sources ?? []) as Array<Record<string, unknown>>;

      for (const src of sources) {
        const staging = src?.staging as Record<string, string> | undefined;
        if (!staging?.table) continue;

        const stagingName = staging.table;
        // Look for the staging YAML in the same directory first, then others
        for (const sDir of [dir, ...SOT_DIRS.filter((d) => d !== dir)]) {
          const stagingPath = path.join(sDir, `${stagingName}.yaml`);
          if (fs.existsSync(stagingPath)) {
            const stagingYaml = fs.readFileSync(stagingPath, "utf-8");
            parts.push(`\n=== Staging Component: ${stagingName} ===\n${stagingYaml}`);
            break;
          }
        }
      }
    } catch {
      // If YAML parse fails, still return the raw text
    }

    return parts.join("\n");
  }

  return null;
}

// ─── Opus Prompt Builder ────────────────────────────────────

/**
 * Build the Opus prompt for transform evaluation.
 * Ported verbatim from mapping-engine's _build_eval_prompt().
 */
export function buildTransformEvalPrompt(
  entityName: string,
  genMappings: GenMappingInput[],
  sotYamlText: string,
): string {
  const mappingJson = JSON.stringify(
    genMappings.map((m) => ({
      target_field: m.targetField,
      source_entity: m.sourceEntity,
      source_field: m.sourceField,
      transform: m.transform,
      mapping_type: m.mappingType,
    })),
    null,
    2,
  );

  return `You are evaluating the **transformation logic** of a data mapping attempt against the Source of Truth (SOT) for the VDS entity '${entityName}'.

NOTE: Source field identification (which ACDC tables/fields are used) is evaluated separately via programmatic comparison. Your job is to evaluate ONLY the transformation logic — how the source data is transformed into the target VDS field.

## Generated Mapping (JSON)

The following JSON was produced by an AI mapping system. Each entry maps a VDS field to ACDC source table(s)/field(s) with an optional expression/transform:

\`\`\`json
${mappingJson}
\`\`\`

## SOT Mapping (YAML with staging layer)

The following is the ground-truth mapping from the production codebase. It may include a VDS-level YAML that references staging YAMLs. Trace through the staging layer to understand the full transformation chain.

${sotYamlText}

## Task

For each VDS field in the JSON mapping above:

1. **Trace the SOT YAML** through its staging layer to understand the complete transformation chain (staging expressions → VDS-level expressions).
2. **Compare transformation logic**: Does the JSON mapping's expression/transform match what the SOT does? Consider:
   - String manipulation (strip, replace, case conversion)
   - Type casting (int, float, date, string)
   - Conditional logic / coalesce / where patterns
   - Date formatting and parsing
   - Hash ID generation
   - Enum/value mapping
   - Filtering conditions (e.g., .where() clauses)
3. **Score the transform** using the categories below.
4. **Summarize** what each side does in plain English so a reviewer can quickly understand.

## Scoring Categories

**transform_match:**
- \`MATCH\`: The transformation logic is equivalent (even if expressed differently or using different syntax)
- \`PARTIAL\`: The general approach is right but details differ (e.g., missing a strip() call, slightly different conditional logic, missing a filter condition)
- \`WRONG\`: Fundamentally different transformation
- \`N/A\`: Both have no transformation (identity) or field is not available in both

**transform_similarity:** A float from 0.0 to 1.0 indicating how close the transforms are.

## Required Output Format

Output ONLY a JSON array inside a \`\`\`json fence. One entry per VDS field:

\`\`\`json
[
  {
    "field": "<vds_field_name>",
    "transform_match": "MATCH|PARTIAL|WRONG|N/A",
    "transform_similarity": 0.0,
    "explanation": "<specific explanation of transform comparison>",
    "sot_summary": "<plain English: what transformation does the SOT apply?>",
    "candidate_summary": "<plain English: what transformation does the JSON mapping claim?>"
  }
]
\`\`\`

Now evaluate the transformation logic for all ${genMappings.length} fields:`;
}

// ─── Response Parsing ───────────────────────────────────────

const VALID_TRANSFORM_MATCHES: TransformMatchType[] = ["MATCH", "PARTIAL", "WRONG", "N/A"];

/**
 * Extract JSON from Opus response — handles markdown fences and raw brackets.
 */
function extractJson(text: string): string | null {
  // Try markdown-fenced JSON first
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Fall back to bracket extraction
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) return text.slice(start, end + 1);

  return null;
}

/**
 * Parse the Opus transform evaluation response into typed results.
 */
export function parseTransformResponse(responseText: string): TransformFieldResult[] {
  const jsonStr = extractJson(responseText);
  if (!jsonStr) return [];

  try {
    const raw = JSON.parse(jsonStr) as Array<Record<string, unknown>>;
    return raw.map((entry) => {
      const match = String(entry.transform_match ?? "N/A").toUpperCase() as TransformMatchType;
      return {
        field: String(entry.field ?? ""),
        transformMatch: VALID_TRANSFORM_MATCHES.includes(match) ? match : "N/A",
        transformSimilarity: Math.max(0, Math.min(1, Number(entry.transform_similarity ?? 0))),
        explanation: String(entry.explanation ?? ""),
        sotSummary: String(entry.sot_summary ?? ""),
        candidateSummary: String(entry.candidate_summary ?? ""),
      };
    });
  } catch {
    return [];
  }
}

// ─── Main Evaluator ─────────────────────────────────────────

import type { LLMProvider } from "@/lib/llm/provider";

/**
 * Run transform evaluation for an entity using Opus.
 */
export async function evaluateTransforms(
  entityName: string,
  genMappings: GenMappingInput[],
  sotYamlText: string,
  provider: LLMProvider,
): Promise<TransformFieldResult[]> {
  if (genMappings.length === 0) return [];

  const prompt = buildTransformEvalPrompt(entityName, genMappings, sotYamlText);

  const response = await provider.generateCompletion({
    systemMessage: "You are an expert data engineer evaluating mapping transformation accuracy.",
    userMessage: prompt,
    model: "claude-opus-4-6",
    maxTokens: 16384,
    temperature: 0,
  });

  const results = parseTransformResponse(response.content);

  console.log(
    `  [transform-eval] ${entityName}: ${results.length} fields evaluated ` +
    `(${response.inputTokens} in, ${response.outputTokens} out)`,
  );

  return results;
}
