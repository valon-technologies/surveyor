/**
 * Auto-give verdicts on wrong fields using SOT as ground truth.
 * Simulates reviewer corrections for testing the feedback loop at scale.
 *
 * Usage:
 *   npx tsx scripts/auto-verdicts.ts                    # all 7 target entities
 *   npx tsx scripts/auto-verdicts.ts loan foreclosure   # specific entities
 *
 * Requires .env.local (for entity-knowledge rebuild which may use API key).
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, fieldMapping, context, learning } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";
import { loadSotForEntity } from "../src/lib/evaluation/sot-loader";
import { matchSources } from "../src/lib/evaluation/source-matcher";
import { loadSotEntity as loadSotYaml } from "../src/lib/sot/yaml-parser";
import { extractVerdictLearning } from "../src/lib/generation/mapping-learning";
import { rebuildEntityKnowledge } from "../src/lib/generation/entity-knowledge";

const DEFAULT_ENTITIES = [
  "loan",
  "foreclosure",
  "borrower",
  "escrow_analysis",
  "loss_mitigation_application",
  "loss_mitigation_plan",
  "bankruptcy_case",
];

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const targets = args.length > 0 ? args : DEFAULT_ENTITIES;

const ws = db.select().from(entity).limit(1).get();
if (!ws) { console.error("No entities in DB"); process.exit(1); }
const WORKSPACE_ID = ws.workspaceId;

async function processEntity(name: string) {
  const ent = db
    .select()
    .from(entity)
    .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, name), eq(entity.side, "target")))
    .get();

  if (!ent) { console.log(`  ⚠ "${name}" not found — skipping`); return 0; }

  // Run eval to get wrong fields
  const result = evaluateEntityMappings(WORKSPACE_ID, ent.id);
  if (!result) { console.log(`  No SOT data — skipping`); return 0; }

  const wrongFields = result.fieldResults.filter(
    (r: any) => !["NO_SOT", "SOT_NULL", "EXACT", "BOTH_NULL"].includes(r.matchType)
  );

  if (wrongFields.length === 0) {
    console.log(`  All scored fields correct — no verdicts needed`);
    return 0;
  }

  // Check if this is an assembly entity with component children
  const componentEntities = db
    .select({ id: entity.id, name: entity.name })
    .from(entity)
    .where(and(eq(entity.parentEntityId, ent.id), eq(entity.workspaceId, WORKSPACE_ID)))
    .all();
  const isAssembly = componentEntities.length > 0;

  // Get latest mappings for this entity
  const targetFields = db.select({ id: field.id, name: field.name }).from(field).where(eq(field.entityId, ent.id)).all();
  const fieldNameToId = new Map(targetFields.map((f) => [f.name, f.id]));

  let verdictCount = 0;

  // Assembly entities: all verdicts go to component-level (parent has no fieldMappings)
  if (isAssembly) {
    const allWrongFieldNames = new Set(wrongFields.map((wf) => wf.field));
    verdictCount += processAssemblyComponentVerdicts(
      ent.id, componentEntities, allWrongFieldNames,
    );
  } else {
    // Flat entity: verdicts on parent mappings directly
    for (const wf of wrongFields) {
      const targetFieldId = fieldNameToId.get(wf.field);
      if (!targetFieldId) continue;

      const mapping = db
        .select()
        .from(fieldMapping)
        .where(and(eq(fieldMapping.targetFieldId, targetFieldId), eq(fieldMapping.isLatest, true)))
        .get();

      if (!mapping) continue;

      let verdict: string;
      let notes: string;

      if (wf.matchType === "NO_GEN") {
        verdict = "missing_source";
        notes = `Should be: ${wf.sotSources.join(", ")}.`;
      } else if (wf.matchType === "DISJOINT") {
        const genTables = wf.genSources.map((s: string) => s.split(".")[0]);
        const sotTables = wf.sotSources.map((s: string) => s.split(".")[0]);
        const tableMatch = genTables.some((t: string) => sotTables.includes(t));
        verdict = tableMatch ? "wrong_field" : "wrong_table";
        notes = `Should be: ${wf.sotSources.join(", ")} (not ${wf.genSources.join(", ")}).`;
      } else if (wf.matchType === "SUBSET") {
        const missing = wf.sotSources.filter((s: string) => !wf.genSources.includes(s));
        verdict = "missing_source";
        notes = `Has ${wf.genSources.join(", ")} but ALSO needs: ${missing.join(", ")}. Must map ALL of: ${wf.sotSources.join(", ")}.`;
      } else if (wf.matchType === "OVERLAP") {
        continue; // Still skip — genuinely ambiguous
      } else if (wf.matchType === "SUPERSET") {
        verdict = "wrong_field";
        notes = `Should be only: ${wf.sotSources.join(", ")} (not ${wf.genSources.join(", ")}).`;
      } else {
        continue;
      }

      db.update(fieldMapping)
        .set({
          sourceVerdict: verdict,
          sourceVerdictNotes: notes,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(fieldMapping.id, mapping.id))
        .run();

      extractVerdictLearning(WORKSPACE_ID, mapping.id);
      verdictCount++;
      console.log(`    ${verdict.padEnd(15)} ${wf.field}`);
    }
  }

  // Auto-validate pending learnings from SOT verdicts and rebuild EK.
  // SOT-derived verdicts are ground truth — no admin approval needed.
  if (verdictCount > 0) {
    const entityIds = isAssembly
      ? [ent.id, ...componentEntities.map((c) => c.id)]
      : [ent.id];

    for (const entId of entityIds) {
      const validated = db.update(learning)
        .set({ validationStatus: "validated" })
        .where(and(
          eq(learning.workspaceId, WORKSPACE_ID),
          eq(learning.entityId, entId),
          eq(learning.validationStatus, "pending"),
          eq(learning.source, "review"),
        ))
        .run();

      if (validated.changes > 0) {
        rebuildEntityKnowledge(WORKSPACE_ID, entId);
      }
    }
  }

  // Check Entity Knowledge
  const ekEntityIds = isAssembly
    ? componentEntities.map((c) => c.id)
    : [ent.id];

  for (const ekId of ekEntityIds) {
    const ek = db
      .select({ content: context.content })
      .from(context)
      .where(and(eq(context.workspaceId, WORKSPACE_ID), eq(context.subcategory, "entity_knowledge"), eq(context.entityId, ekId)))
      .get();

    if (ek) {
      const ekName = isAssembly
        ? componentEntities.find((c) => c.id === ekId)?.name || "unknown"
        : name;
      const lines = ek.content?.split("\n").length ?? 0;
      console.log(`  Entity Knowledge (${ekName}): ${lines} lines`);
    }
  }

  return verdictCount;
}

/**
 * Give component-level verdicts for assembly entity fields.
 *
 * Uses the parent's stagingDetail (already loaded with resolved ACDC sources)
 * to match DB component names to SOT staging components. This avoids filename
 * vs table name mismatches when loading component SOT separately.
 *
 * For each DB component, finds the best-matching SOT staging component by
 * longest common prefix, then compares the component's generated mappings
 * against that staging component's SOT sources.
 */
function processAssemblyComponentVerdicts(
  parentEntityId: string,
  componentEntities: { id: string; name: string }[],
  targetFieldNames: Set<string>,
): number {
  let verdictCount = 0;

  // Resolve entity/field names for genSources
  const allEntities = db.select({ id: entity.id, name: entity.name }).from(entity).all();
  const entityNameById = new Map(allEntities.map((e) => [e.id, e.name]));
  const allFields = db.select({ id: field.id, name: field.name }).from(field).all();
  const fieldNameById = new Map(allFields.map((f) => [f.id, f.name]));

  // Load parent SOT YAML — stagingDetail has each component's columns with ACDC sources
  const parentEntity = db.select({ name: entity.name }).from(entity)
    .where(eq(entity.id, parentEntityId)).get();
  if (!parentEntity) return 0;

  const parentYaml = loadSotYaml(parentEntity.name, "m2") || loadSotYaml(parentEntity.name, "m1");
  if (!parentYaml?.stagingDetail || parentYaml.stagingDetail.length === 0) {
    console.log(`  (no staging detail in parent SOT for "${parentEntity.name}")`);
    return 0;
  }

  // Match each DB component to a SOT staging component by longest common prefix.
  // E.g., "borrower_coborrower" → "borrower_comrtgr" (share "borrower_co" prefix)
  const usedSotIndices = new Set<number>();

  for (const comp of componentEntities) {
    // Find best matching staging component
    let bestIdx = -1;
    let bestPrefixLen = 0;
    for (let i = 0; i < parentYaml.stagingDetail.length; i++) {
      if (usedSotIndices.has(i)) continue;
      const sotName = parentYaml.stagingDetail[i].componentName;
      // Exact match always wins
      if (sotName === comp.name) { bestIdx = i; break; }
      // Longest common prefix
      let pfx = 0;
      while (pfx < comp.name.length && pfx < sotName.length && comp.name[pfx] === sotName[pfx]) pfx++;
      if (pfx > bestPrefixLen) { bestPrefixLen = pfx; bestIdx = i; }
    }

    if (bestIdx < 0) {
      console.log(`  (no SOT staging match for "${comp.name}")`);
      continue;
    }

    usedSotIndices.add(bestIdx);
    const stagingComp = parentYaml.stagingDetail[bestIdx];
    if (stagingComp.componentName !== comp.name) {
      console.log(`  Component mapping: ${comp.name} → ${stagingComp.componentName}`);
    }

    // Build field → SOT sources from staging component columns
    const compSotByField = new Map<string, string[]>();
    for (const col of stagingComp.columns) {
      if (col.resolvedSources.length > 0) {
        compSotByField.set(col.targetColumn, col.resolvedSources);
      }
    }

    // Get component's target fields
    const compFields = db
      .select({ id: field.id, name: field.name })
      .from(field)
      .where(eq(field.entityId, comp.id))
      .all();

    for (const cf of compFields) {
      if (!targetFieldNames.has(cf.name)) continue;

      const sotSources = compSotByField.get(cf.name);
      if (!sotSources || sotSources.length === 0) continue;

      // Get component's latest mapping for this field
      const mapping = db
        .select()
        .from(fieldMapping)
        .where(and(eq(fieldMapping.targetFieldId, cf.id), eq(fieldMapping.isLatest, true)))
        .get();

      if (!mapping) continue;

      // Build genSources
      const genSources: string[] = [];
      if (mapping.sourceEntityId && mapping.sourceFieldId) {
        const seName = entityNameById.get(mapping.sourceEntityId);
        const sfName = fieldNameById.get(mapping.sourceFieldId);
        if (seName && sfName) genSources.push(`${seName}.${sfName}`);
      }

      const { matchType } = matchSources(genSources, sotSources, true);

      if (matchType === "EXACT" || matchType === "BOTH_NULL") continue;

      let verdict: string;
      let notes: string;

      if (matchType === "NO_GEN") {
        verdict = "missing_source";
        notes = `Must map to: ${sotSources.join(", ")}.`;
      } else if (matchType === "DISJOINT") {
        verdict = "wrong_table";
        notes = `Must use: ${sotSources.join(", ")} (not ${genSources.join(", ")}).`;
      } else if (matchType === "SUBSET") {
        const missing = sotSources.filter((s) => !genSources.includes(s));
        verdict = "missing_source";
        notes = `Has ${genSources.join(", ")} but ALSO needs: ${missing.join(", ")}. Must map ALL of: ${sotSources.join(", ")}.`;
      } else {
        continue;
      }

      db.update(fieldMapping)
        .set({
          sourceVerdict: verdict,
          sourceVerdictNotes: notes,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(fieldMapping.id, mapping.id))
        .run();

      extractVerdictLearning(WORKSPACE_ID, mapping.id);
      verdictCount++;
      console.log(`    ${verdict.padEnd(15)} ${comp.name}.${cf.name}`);
    }
  }

  return verdictCount;
}

async function main() {
  console.log(`\nAuto-Verdicts (using SOT as ground truth)\n`);

  let totalVerdicts = 0;
  for (const name of targets) {
    console.log(`[${name}]`);
    totalVerdicts += await processEntity(name);
  }

  console.log(`\nTotal verdicts given: ${totalVerdicts}`);
  console.log("Run multi-entity-eval.ts again to measure improvement.");
}

main().catch(console.error);
