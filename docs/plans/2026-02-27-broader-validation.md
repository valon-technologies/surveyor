# Broader Feedback Loop Validation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run the generate → eval → verdict → regenerate loop on 7 entities across 4 domains to prove the feedback mechanism generalizes beyond a single entity.

**Architecture:** A single multi-entity CLI script (`scripts/multi-entity-eval.ts`) that takes entity names as args, resolves them to IDs from the DB, and runs: clear stale mappings → generate (Opus) → persist mappings → SOT eval → print results table. A second script (`scripts/auto-verdicts.ts`) reads SOT eval results for wrong fields and programmatically gives verdicts using the SOT as the correction source. Then re-run the first script to measure improvement.

**Tech Stack:** TypeScript, Drizzle ORM, existing generation/evaluation pipeline, `npx tsx` runner.

---

### Task 1: Create multi-entity generate + eval script

**Files:**
- Create: `scripts/multi-entity-eval.ts`

**Step 1: Write the script**

This script accepts entity names as CLI args (or defaults to the 7 target entities), resolves them to IDs, and for each: clears stale mappings, runs generation, persists mappings from outputParsed, runs SOT eval, collects results.

```typescript
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
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, fieldMapping, generation } from "../src/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { startGeneration, executeGeneration } from "../src/lib/generation/runner";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";

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
import { user } from "../src/lib/db/schema";
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
```

**Step 2: Run it in eval-only mode to verify it works with existing data**

Run: `cd /Users/rob/code/surveyor && npx tsx scripts/multi-entity-eval.ts --eval-only loss_mitigation_loan_modification`
Expected: Shows the existing eval results for loss_mitigation_loan_modification without regenerating.

**Step 3: Commit**

```bash
git add scripts/multi-entity-eval.ts
git commit -m "feat: add multi-entity generate + eval script"
```

---

### Task 2: Run baseline generation on all 7 entities

**Step 1: Run the script on all 7 entities**

Run: `cd /Users/rob/code/surveyor && npx tsx scripts/multi-entity-eval.ts`
Expected: ~17 minutes total (7 entities × ~2.5 min). Prints summary table with baseline accuracy per entity.

**Step 2: Record baseline results**

Copy the summary table output. This is the "before" for the feedback loop test.

**Step 3: Commit the DB state note**

No code commit needed — just record the baseline numbers.

---

### Task 3: Create auto-verdicts script

**Files:**
- Create: `scripts/auto-verdicts.ts`

**Step 1: Write the script**

This script reads SOT eval results for entities that have wrong fields, and programmatically gives verdicts using the SOT data as the correction source. This simulates what a reviewer would do.

```typescript
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
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, fieldMapping, context } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";
import { extractVerdictLearning } from "../src/lib/generation/mapping-learning";

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

  // Get latest mappings for this entity
  const targetFields = db.select({ id: field.id, name: field.name }).from(field).where(eq(field.entityId, ent.id)).all();
  const fieldNameToId = new Map(targetFields.map((f) => [f.name, f.id]));

  let verdictCount = 0;
  for (const wf of wrongFields) {
    const targetFieldId = fieldNameToId.get(wf.field);
    if (!targetFieldId) continue;

    // Find the latest mapping for this field
    const mapping = db
      .select()
      .from(fieldMapping)
      .where(and(eq(fieldMapping.targetFieldId, targetFieldId), eq(fieldMapping.isLatest, true)))
      .get();

    if (!mapping) continue;

    // Determine verdict type and notes based on match type
    let verdict: string;
    let notes: string;

    if (wf.matchType === "NO_GEN") {
      verdict = "missing_source";
      notes = `Should map to: ${wf.sotSources.join(", ")}`;
    } else if (wf.matchType === "DISJOINT") {
      // Check if it's a table mismatch or field mismatch
      const genTables = wf.genSources.map((s: string) => s.split(".")[0]);
      const sotTables = wf.sotSources.map((s: string) => s.split(".")[0]);
      const tableMatch = genTables.some((t: string) => sotTables.includes(t));
      verdict = tableMatch ? "wrong_field" : "wrong_table";
      notes = `Should be: ${wf.sotSources.join(", ")}. Currently mapped to: ${wf.genSources.join(", ")}`;
    } else if (wf.matchType === "OVERLAP" || wf.matchType === "SUBSET") {
      verdict = "wrong_field";
      notes = `Expected sources: ${wf.sotSources.join(", ")}. Generated: ${wf.genSources.join(", ")}`;
    } else if (wf.matchType === "SUPERSET") {
      // SUPERSET means correct + extra — arguably correct, but give a mild verdict
      verdict = "wrong_field";
      notes = `Has extra sources beyond expected. Expected: ${wf.sotSources.join(", ")}. Generated: ${wf.genSources.join(", ")}`;
    } else {
      continue; // Skip unknown types
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

  // Check Entity Knowledge was rebuilt
  const ek = db
    .select({ content: context.content })
    .from(context)
    .where(and(eq(context.workspaceId, WORKSPACE_ID), eq(context.subcategory, "entity_knowledge"), eq(context.entityId, ent.id)))
    .get();

  if (ek) {
    const lines = ek.content?.split("\n").length ?? 0;
    console.log(`  Entity Knowledge: ${lines} lines`);
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
```

**Step 2: Commit**

```bash
git add scripts/auto-verdicts.ts
git commit -m "feat: add auto-verdicts script using SOT as ground truth"
```

---

### Task 4: Run the full feedback loop on all 7 entities

**Step 1: Run auto-verdicts**

Run: `cd /Users/rob/code/surveyor && npx tsx scripts/auto-verdicts.ts`
Expected: Gives verdicts on all wrong fields across 7 entities. Prints verdict count per entity. Entity Knowledge docs rebuilt for each.

**Step 2: Regenerate all 7 entities**

Run: `cd /Users/rob/code/surveyor && npx tsx scripts/multi-entity-eval.ts`
Expected: ~17 minutes. Each entity now has Entity Knowledge corrections in its context. Summary table shows post-feedback accuracy.

**Step 3: Record results and compare**

Compare before/after tables. Key questions:
- How many entities improved?
- What's the aggregate accuracy change?
- Do wrong-table corrections still apply perfectly?
- Do any entities regress?

**Step 4: Commit results note**

Save the before/after comparison to the handoff doc or a new results file.

```bash
git add docs/
git commit -m "docs: record broader validation results (7 entities)"
```

---

### Task 5: Analyze results and decide on deployment

**Step 1: Review the data**

Look at:
- Which domains improved most/least?
- Are there entities where the loop didn't help? Why?
- What types of corrections work best (wrong_table vs missing_source vs wrong_field)?
- Rough estimate: how many verdicts per entity, extrapolated to 92 entities?

**Step 2: Go/no-go on deployment**

If the loop works on 5+ of 7 entities → proceed to deployment (Part 2 of the design doc).
If results are inconsistent → investigate why before investing in infra.

No code in this step — it's a decision checkpoint.
