#!/usr/bin/env npx tsx
/**
 * Run SOT accuracy evaluation across all entities with SOT data.
 *
 * Usage:
 *   npx tsx scripts/run-sot-eval.ts [--entity loan] [--dry-run] [--include-transform]
 *
 * --include-transform: Run Opus-based transform evaluation (~$10-15 for all entities)
 */

import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, fieldMapping, sotEvaluation } from "../src/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";
import { listAvailableSotEntities } from "../src/lib/evaluation/sot-loader";
import { ClaudeProvider } from "../src/lib/llm/providers/claude";
import type { LLMProvider } from "../src/lib/llm/provider";

const dryRun = process.argv.includes("--dry-run");
const includeTransform = process.argv.includes("--include-transform");
const entityArg = process.argv.indexOf("--entity");
const targetEntityName = entityArg >= 0 ? process.argv[entityArg + 1] : null;

async function main() {
  const mode = includeTransform ? "source + transform" : "source only";
  console.log(`=== SOT Accuracy Evaluation (${mode})${dryRun ? " (DRY RUN)" : ""} ===\n`);

  // Get workspace
  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities"); process.exit(1); }
  const workspaceId = firstEntity.workspaceId;

  // List entities with SOT data
  const sotEntities = await listAvailableSotEntities();
  console.log(`Entities with SOT data: ${sotEntities.length}`);

  // Get target entities that have mappings (SDT only — no transferId)
  const allTargetEntities = await db
    .select({ id: entity.id, name: entity.name })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")));

  const entityByName = new Map(allTargetEntities.map((e) => [e.name, e]));

  // Filter to entities with SOT + mappings
  const toEvaluate = sotEntities
    .filter((name) => entityByName.has(name))
    .filter((name) => !targetEntityName || name === targetEntityName)
    .map((name) => entityByName.get(name)!);

  console.log(`Entities to evaluate: ${toEvaluate.length}\n`);

  if (dryRun) {
    for (const e of toEvaluate) console.log(`  ${e.name}`);
    console.log("\nDry run — no evaluations run.");
    process.exit(0);
  }

  // Resolve provider for transform eval
  let provider: LLMProvider | undefined;
  if (includeTransform) {
    provider = new ClaudeProvider();
    console.log("Using Opus for transform evaluation\n");
  }

  let completed = 0;
  let skipped = 0;
  let totalSrcExact = 0;
  let totalSrcScored = 0;
  let totalTxfmExact = 0;
  let totalTxfmLenient = 0;
  let totalTxfmScored = 0;

  for (const te of toEvaluate) {
    try {
      const result = await evaluateEntityMappings(workspaceId, te.id, {
        includeTransform,
        provider,
      });
      if (!result) {
        console.log(`  ${te.name}: skipped (no SOT data)`);
        skipped++;
        continue;
      }

      // Persist
      await db.insert(sotEvaluation).values({
        workspaceId,
        entityId: te.id,
        generationId: result.generationId,
        totalFields: result.totalFields,
        scoredFields: result.scoredFields,
        sourceExactCount: result.sourceExactCount,
        sourceLenientCount: result.sourceLenientCount,
        sourceExactPct: result.sourceExactPct,
        sourceLenientPct: result.sourceLenientPct,
        transformExactCount: result.transformExactCount ?? null,
        transformLenientCount: result.transformLenientCount ?? null,
        transformExactPct: result.transformExactPct ?? null,
        transformLenientPct: result.transformLenientPct ?? null,
        fieldResults: result.fieldResults,
      });

      totalSrcExact += result.sourceExactCount;
      totalSrcScored += result.scoredFields;
      completed++;

      let line = `  ${te.name}: src ${result.sourceExactPct.toFixed(1)}%/${result.sourceLenientPct.toFixed(1)}%`;
      if (result.transformExactPct != null) {
        line += ` | txfm ${result.transformExactPct.toFixed(1)}%/${result.transformLenientPct!.toFixed(1)}%`;
        totalTxfmExact += result.transformExactCount!;
        totalTxfmLenient += result.transformLenientCount!;
        totalTxfmScored += result.scoredFields;
      }
      line += ` (${result.scoredFields} fields)`;
      console.log(line);
    } catch (err) {
      console.error(`  ${te.name}: ERROR — ${err}`);
    }
  }

  const overallSrcExact = totalSrcScored > 0 ? ((totalSrcExact / totalSrcScored) * 100).toFixed(1) : "N/A";
  console.log(`\n=== Summary ===`);
  console.log(`Evaluated: ${completed} | Skipped: ${skipped}`);
  console.log(`Source exact: ${overallSrcExact}% (${totalSrcExact}/${totalSrcScored} fields)`);

  if (includeTransform && totalTxfmScored > 0) {
    const overallTxfmExact = ((totalTxfmExact / totalTxfmScored) * 100).toFixed(1);
    const overallTxfmLenient = ((totalTxfmLenient / totalTxfmScored) * 100).toFixed(1);
    console.log(`Transform exact: ${overallTxfmExact}% (${totalTxfmExact}/${totalTxfmScored} fields)`);
    console.log(`Transform lenient: ${overallTxfmLenient}% (${totalTxfmLenient}/${totalTxfmScored} fields)`);
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
