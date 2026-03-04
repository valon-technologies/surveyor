/**
 * Multi-entity generate + SOT eval.
 *
 * Usage:
 *   npx tsx scripts/multi-entity-eval.ts                    # all 7 target entities
 *   npx tsx scripts/multi-entity-eval.ts loan foreclosure   # specific entities
 *   npx tsx scripts/multi-entity-eval.ts --eval-only        # skip generation, just eval
 *
 * Requires .env.local with API_KEY_ENCRYPTION_SECRET.
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, fieldMapping, generation, user, mappingContext } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { startGeneration, executeGeneration } from "../src/lib/generation/runner";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";
import { extractCitations } from "../src/lib/generation/citation-parser";

const DEFAULT_ENTITIES = [
  "loan",
  "foreclosure",
  "borrower",
  "escrow_analysis",
  "loss_mitigation_application",
  "loss_mitigation_plan",
  "bankruptcy_case",
];

// Parse args
const args = process.argv.slice(2);
const evalOnly = args.includes("--eval-only");
const entityNames = args.filter((a) => !a.startsWith("--"));
const targets = entityNames.length > 0 ? entityNames : DEFAULT_ENTITIES;

// Resolve workspace ID
const ws = db.select().from(entity).limit(1).get();
if (!ws) { console.error("No entities in DB"); process.exit(1); }
const WORKSPACE_ID = ws.workspaceId;

// Resolve user ID (first user)
const usr = db.select().from(user).limit(1).get();
if (!usr) { console.error("No users in DB"); process.exit(1); }
const USER_ID = usr.id;

interface Result {
  name: string;
  entityId: string;
  sourceExactPct: number;
  sourceLenientPct: number;
  scoredFields: number;
  sourceExactCount: number;
  wrongFields: { field: string; matchType: string; gen: string; sot: string }[];
  elapsed: number;
}

async function processEntity(name: string): Promise<Result | null> {
  // Resolve entity
  const ent = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, name), eq(entity.side, "target")))
    .get();

  if (!ent) {
    console.log(`  ⚠ Entity "${name}" not found in DB — skipping`);
    return null;
  }

  const start = Date.now();

  if (!evalOnly) {
    // Clear stale mappings
    const targetFields = db.select({ id: field.id }).from(field).where(eq(field.entityId, ent.id)).all();
    for (const tf of targetFields) {
      db.update(fieldMapping)
        .set({ isLatest: false })
        .where(and(eq(fieldMapping.targetFieldId, tf.id), eq(fieldMapping.isLatest, true)))
        .run();
    }

    // Generate
    console.log(`  Generating (Opus)...`);
    const { prepared } = startGeneration({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      entityId: ent.id,
      generationType: "batch",
      preferredProvider: "claude",
    });

    await executeGeneration(prepared);

    // Persist mappings from outputParsed (executeGeneration doesn't do this)
    const gen = db
      .select()
      .from(generation)
      .where(and(eq(generation.id, prepared.generationId)))
      .get();

    if (gen?.outputParsed) {
      const parsed = gen.outputParsed as any;
      const mappings = parsed.fieldMappings || [];
      for (const fm of mappings) {
        if (!fm.targetFieldId) continue;
        db.insert(fieldMapping).values({
          id: crypto.randomUUID(),
          workspaceId: WORKSPACE_ID,
          targetFieldId: fm.targetFieldId,
          status: "unreviewed",
          mappingType: fm.mappingType || "direct",
          sourceEntityId: fm.sourceEntityId || null,
          sourceFieldId: fm.sourceFieldId || null,
          transform: fm.transform || null,
          defaultValue: fm.defaultValue || null,
          enumMapping: fm.enumMapping || null,
          reasoning: fm.reasoning || null,
          confidence: fm.confidence || null,
          notes: fm.notes || fm.reviewComment || null,
          createdBy: "llm",
          assigneeId: USER_ID,
          generationId: gen.id,
          version: 1,
          isLatest: true,
        }).run();
      }
      console.log(`  Persisted ${mappings.length} mappings`);

      // Citation-based context linking
      const promptSnap = gen.promptSnapshot as Record<string, unknown> | null;
      const contextUsed = (promptSnap?.contextUsed ?? []) as { id: string; name: string }[];
      if (contextUsed.length > 0) {
        const contextIdSet = new Set(contextUsed.map((c) => c.id));
        let citedCount = 0;
        let fallbackCount = 0;

        for (const fm of mappings) {
          if (!fm.targetFieldId) continue;
          // Find the mapping we just inserted
          const saved = db.select({ id: fieldMapping.id }).from(fieldMapping)
            .where(and(eq(fieldMapping.targetFieldId, fm.targetFieldId), eq(fieldMapping.isLatest, true)))
            .get();
          if (!saved) continue;

          const cited = extractCitations(fm.reasoning, fm.notes, fm.reviewComment);
          const validCited = [...cited].filter((id) => contextIdSet.has(id));

          if (validCited.length > 0) {
            for (const ctxId of validCited) {
              db.insert(mappingContext).values({
                fieldMappingId: saved.id, contextId: ctxId, contextType: "context_reference",
              }).run();
            }
            citedCount++;
          } else {
            for (const ctx of contextUsed) {
              db.insert(mappingContext).values({
                fieldMappingId: saved.id, contextId: ctx.id, contextType: "context_reference",
              }).run();
            }
            fallbackCount++;
          }
        }
        console.log(`  Context links: ${citedCount} citation-based, ${fallbackCount} fallback (${contextUsed.length} docs available)`);
      }
    }
  }

  // SOT eval
  const result = evaluateEntityMappings(WORKSPACE_ID, ent.id);
  const elapsed = (Date.now() - start) / 1000;

  if (!result) {
    console.log(`  No SOT data for ${name}`);
    return null;
  }

  const wrongFields = result.fieldResults
    .filter((r: any) => !["NO_SOT", "SOT_NULL", "EXACT", "BOTH_NULL"].includes(r.matchType))
    .map((r: any) => ({
      field: r.field,
      matchType: r.matchType,
      gen: r.genSources.join(", ") || "(unmapped)",
      sot: r.sotSources.join(", ") || "(none)",
    }));

  return {
    name,
    entityId: ent.id,
    sourceExactPct: result.sourceExactPct,
    sourceLenientPct: result.sourceLenientPct,
    scoredFields: result.scoredFields,
    sourceExactCount: result.sourceExactCount,
    wrongFields,
    elapsed,
  };
}

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Multi-Entity ${evalOnly ? "Eval" : "Generate + Eval"}`);
  console.log(`Entities: ${targets.join(", ")}`);
  console.log(`${"=".repeat(70)}\n`);

  const results: Result[] = [];

  for (const name of targets) {
    console.log(`\n[${name}]`);
    const r = await processEntity(name);
    if (r) results.push(r);
  }

  // Summary table
  console.log(`\n${"=".repeat(70)}`);
  console.log("RESULTS SUMMARY");
  console.log(`${"=".repeat(70)}`);
  console.log(
    "Entity".padEnd(40),
    "Exact".padStart(8),
    "Lenient".padStart(8),
    "Scored".padStart(8),
    "Wrong".padStart(8),
    "Time".padStart(8),
  );
  console.log("-".repeat(80));

  for (const r of results) {
    console.log(
      r.name.padEnd(40),
      `${r.sourceExactPct.toFixed(1)}%`.padStart(8),
      `${r.sourceLenientPct.toFixed(1)}%`.padStart(8),
      `${r.scoredFields}`.padStart(8),
      `${r.wrongFields.length}`.padStart(8),
      `${r.elapsed.toFixed(1)}s`.padStart(8),
    );
  }

  const totalScored = results.reduce((s, r) => s + r.scoredFields, 0);
  const totalExact = results.reduce((s, r) => s + r.sourceExactCount, 0);
  const avgExact = totalScored > 0 ? (totalExact / totalScored) * 100 : 0;
  console.log("-".repeat(80));
  console.log(`AGGREGATE: ${avgExact.toFixed(1)}% exact (${totalExact}/${totalScored} fields)`);

  // Per-entity wrong field details
  console.log(`\n${"=".repeat(70)}`);
  console.log("WRONG FIELDS BY ENTITY");
  console.log(`${"=".repeat(70)}`);
  for (const r of results) {
    if (r.wrongFields.length === 0) continue;
    console.log(`\n  ${r.name} (${r.wrongFields.length} wrong):`);
    for (const wf of r.wrongFields) {
      console.log(`    ${wf.matchType.padEnd(12)} ${wf.field.padEnd(45)} gen=${wf.gen}`);
      console.log(`${"".padEnd(58)} sot=${wf.sot}`);
    }
  }
}

main().catch(console.error);
