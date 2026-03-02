# EK Hardening, Feedback Validation, and Cycle 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden Entity Knowledge phrasing so the model stops overriding corrections, validate the feedback pipeline end-to-end with manual examples, import missing source tables, and run a second feedback loop cycle to push accuracy past 40%.

**Architecture:** Four sequential phases — code changes to EK phrasing (4 files), manual smoke test of the feedback capture pipeline, BigQuery table import, then a full generate→verdict→regen cycle across 7 entities.

**Tech Stack:** TypeScript (Next.js), SQLite (better-sqlite3/drizzle), Python (mapping-engine CLI), BigQuery

---

### Task 1: Harden auto-verdict note templates

**Files:**
- Modify: `scripts/auto-verdicts.ts:84-103`

**Step 1: Update note templates**

Replace lines 84-103 with:

```typescript
    if (wf.matchType === "NO_GEN") {
      verdict = "missing_source";
      notes = `REQUIRED: Map to ${wf.sotSources.join(", ")}. This is a verified correction.`;
    } else if (wf.matchType === "DISJOINT") {
      // Check if it's a table mismatch or field mismatch
      const genTables = wf.genSources.map((s: string) => s.split(".")[0]);
      const sotTables = wf.sotSources.map((s: string) => s.split(".")[0]);
      const tableMatch = genTables.some((t: string) => sotTables.includes(t));
      verdict = tableMatch ? "wrong_field" : "wrong_table";
      notes = `REQUIRED: Use ${wf.sotSources.join(", ")} (not ${wf.genSources.join(", ")}). This is a verified correction — do not override.`;
    } else if (wf.matchType === "OVERLAP" || wf.matchType === "SUBSET") {
      verdict = "wrong_field";
      notes = `REQUIRED: Must include all of: ${wf.sotSources.join(", ")} (currently only: ${wf.genSources.join(", ")}). Verified correction.`;
    } else if (wf.matchType === "SUPERSET") {
      verdict = "wrong_field";
      notes = `REQUIRED: Use only ${wf.sotSources.join(", ")} (not ${wf.genSources.join(", ")}). Extra sources are incorrect. Verified correction.`;
    } else {
      continue;
    }
```

**Step 2: Verify syntax**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit scripts/auto-verdicts.ts 2>&1 | head -20`

Note: This script uses path aliases that may not resolve under bare tsc. If tsc fails on import paths, just verify the file parses: `node -e "require('typescript').createSourceFile('x.ts', require('fs').readFileSync('scripts/auto-verdicts.ts','utf8'), 99)"`

**Step 3: Commit**

```bash
git add scripts/auto-verdicts.ts
git commit -m "feat: harden auto-verdict note templates to REQUIRED phrasing"
```

---

### Task 2: Harden verdict learning content templates

**Files:**
- Modify: `src/lib/generation/mapping-learning.ts:305-310`

**Step 1: Update contentMap in extractVerdictLearning**

Replace the source verdict `contentMap` (lines 305-310) with:

```typescript
    const contentMap: Record<string, string> = {
      wrong_table: `${prefix}: CORRECTION (MANDATORY): Wrong source table. Do NOT use ${currentSrc}.${notes}`,
      wrong_field: `${prefix}: CORRECTION (MANDATORY): Wrong source field within ${mapping.sourceEntityName || "the entity"}.${notes}`,
      should_be_unmapped: `${prefix}: This field has no source. Do NOT attempt to map it — leave unmapped.`,
      missing_source: `${prefix}: CORRECTION (MANDATORY): This field MUST be mapped — do not leave unmapped.${notes}`,
    };
```

**Step 2: Verify the build**

Run: `cd /Users/rob/code/surveyor && npx next build 2>&1 | tail -5`

If full build is slow, just check types: `npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/lib/generation/mapping-learning.ts
git commit -m "feat: harden verdict learning content to MANDATORY phrasing"
```

---

### Task 3: Add EK authority rule to system prompts

**Files:**
- Modify: `src/lib/generation/prompt-builder.ts:67-165` (SYSTEM_MESSAGE) and `249-380` (YAML_SYSTEM_MESSAGE)

**Step 1: Add rule to JSON SYSTEM_MESSAGE**

After line 165 (the last line of `SELF-REVIEW CHECKLIST`), before the closing backtick, add:

```

ENTITY KNOWLEDGE RULE: Reference documents titled "Entity Knowledge" contain verified corrections from human reviewers. These corrections are MANDATORY — follow them exactly. If a correction says "REQUIRED: Use X" or "CORRECTION (MANDATORY)", you MUST use X. Do not argue against, reinterpret, or override these corrections under any circumstances. They take precedence over your own reasoning about which source table or field is "better."
```

**Step 2: Add same rule to YAML_SYSTEM_MESSAGE**

After line 380 (the last line of the YAML `SELF-REVIEW CHECKLIST`), before the closing backtick, add the identical paragraph.

**Step 3: Verify the build**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
git add src/lib/generation/prompt-builder.ts
git commit -m "feat: add ENTITY KNOWLEDGE RULE to system prompts"
```

---

### Task 4: Add authority preamble to EK corrections section

**Files:**
- Modify: `src/lib/generation/entity-knowledge.ts:228`

**Step 1: Update renderDocument section header**

Replace line 228:
```typescript
    parts.push(`## Source & Transform Corrections\n`);
```

with:
```typescript
    parts.push(`## Source & Transform Corrections (MANDATORY)\n`);
    parts.push(`These corrections have been verified by human reviewers. Follow each one exactly. Do NOT override or argue against them.\n`);
```

**Step 2: Verify the build**

Run: `cd /Users/rob/code/surveyor && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/lib/generation/entity-knowledge.ts
git commit -m "feat: add MANDATORY preamble to EK corrections section"
```

---

### Task 5: Manual feedback capture validation — setup

This task identifies specific fields to test with and gathers their IDs from the database.

**Step 1: Get workspace ID and pick test entity**

```bash
cd /Users/rob/code/surveyor
node -e "
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');
const ws = db.prepare('SELECT DISTINCT workspaceId FROM entity LIMIT 1').get();
console.log('WORKSPACE_ID:', ws.workspaceId);

// Get foreclosure entity (has existing mappings from round 1)
const ent = db.prepare(\"SELECT id, name FROM entity WHERE name = 'foreclosure' AND side = 'target'\").get();
console.log('ENTITY_ID:', ent.id, ent.name);

// Get 4 field mappings with isLatest=true
const mappings = db.prepare(\"
  SELECT fm.id as mappingId, f.name as fieldName,
    se.name as sourceEntity, sf.name as sourceField,
    fm.sourceVerdict, fm.transform
  FROM field_mapping fm
  JOIN field f ON fm.targetFieldId = f.id
  LEFT JOIN entity se ON fm.sourceEntityId = se.id
  LEFT JOIN field sf ON fm.sourceFieldId = sf.id
  WHERE f.entityId = ? AND fm.isLatest = 1
  LIMIT 8
\").all(ent.id);
console.log('\\nAvailable mappings:');
mappings.forEach(m => console.log(' ', m.fieldName, '->', m.sourceEntity + '.' + m.sourceField, '| verdict:', m.sourceVerdict, '| mappingId:', m.mappingId));
"
```

Record the workspace ID, entity ID, and pick 4 mapping IDs for testing:
- **Field A** — will get `wrong_table` source verdict
- **Field B** — will get `wrong_field` source verdict
- **Field C** — will get `wrong_logic` transform verdict
- **Field D** — check if any questions exist to resolve

**Step 2: Check for existing questions**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');
const questions = db.prepare(\"
  SELECT q.id, q.question, q.status, f.name as fieldName
  FROM question q
  LEFT JOIN field f ON q.fieldId = f.id
  WHERE q.entityId = (SELECT id FROM entity WHERE name = 'foreclosure' AND side = 'target')
  AND q.status = 'open'
  LIMIT 5
\").all();
console.log('Open questions:', JSON.stringify(questions, null, 2));
"
```

---

### Task 6: Manual feedback capture validation — source verdicts

Ensure Surveyor is running at http://localhost:3000.

**Step 1: Submit wrong_table verdict on Field A**

```bash
# Replace {WORKSPACE_ID} and {MAPPING_ID_A} with values from Task 5
curl -s -X PATCH "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/mappings/{MAPPING_ID_A}/verdict" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceVerdict": "wrong_table",
    "sourceVerdictNotes": "REQUIRED: Use PaymentFactors.TestField (not LoanInfo.TestField). This is a verified correction — do not override."
  }' | jq .
```

Expected: 200 OK with updated mapping.

**Step 2: Submit wrong_field verdict on Field B**

```bash
curl -s -X PATCH "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/mappings/{MAPPING_ID_B}/verdict" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceVerdict": "wrong_field",
    "sourceVerdictNotes": "REQUIRED: Use Step.EventDate (not Step.StepDate). Verified correction."
  }' | jq .
```

**Step 3: Verify learning records were created**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');
const learnings = db.prepare(\"
  SELECT content, source, scope, fieldName, createdAt
  FROM learning
  WHERE entityId = (SELECT id FROM entity WHERE name = 'foreclosure' AND side = 'target')
  ORDER BY createdAt DESC
  LIMIT 10
\").all();
learnings.forEach(l => console.log('[' + l.scope + '/' + l.source + '] ' + l.fieldName + ': ' + l.content.substring(0, 120)));
"
```

Expected: See two new learning records with `CORRECTION (MANDATORY)` phrasing.

**Step 4: Verify Entity Knowledge was rebuilt**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');
const ek = db.prepare(\"
  SELECT content, updatedAt
  FROM context
  WHERE subcategory = 'entity_knowledge'
  AND entityId = (SELECT id FROM entity WHERE name = 'foreclosure' AND side = 'target')
\").get();
if (ek) {
  console.log('Updated:', ek.updatedAt);
  console.log('---');
  console.log(ek.content.substring(0, 800));
} else {
  console.log('NO EK FOUND');
}
"
```

Expected: Content starts with `# Entity Knowledge: foreclosure` then `## Source & Transform Corrections (MANDATORY)` with the preamble text, followed by the two corrections.

---

### Task 7: Manual feedback capture validation — transform verdict

**Step 1: Submit wrong_logic transform verdict on Field C**

```bash
curl -s -X PATCH "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/mappings/{MAPPING_ID_C}/verdict" \
  -H "Content-Type: application/json" \
  -d '{
    "transformVerdict": "wrong_logic",
    "transformVerdictNotes": "Should use CAST(EventDate AS DATE) not raw timestamp"
  }' | jq .
```

**Step 2: Verify learning + EK rebuild**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');
const learnings = db.prepare(\"
  SELECT content, fieldName FROM learning
  WHERE entityId = (SELECT id FROM entity WHERE name = 'foreclosure' AND side = 'target')
  ORDER BY createdAt DESC LIMIT 5
\").all();
learnings.forEach(l => console.log(l.fieldName + ': ' + l.content.substring(0, 150)));
"
```

Expected: New learning with transform verdict content.

**Step 3: Verify feedback event trail**

```bash
curl -s "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/feedback-events?entityId={ENTITY_ID}" | jq '.[0:6] | .[] | {eventType, createdAt}'
```

Expected: Chain of `verdict_submitted` → `learning_created` → `entity_knowledge_rebuilt` events.

---

### Task 8: Manual feedback capture validation — question resolution

**Step 1: If open questions exist from Task 5, resolve one**

```bash
# Replace {QUESTION_ID} with an open question ID from Task 5
curl -s -X POST "http://localhost:3000/api/workspaces/{WORKSPACE_ID}/questions/{QUESTION_ID}/resolve" \
  -H "Content-Type: application/json" \
  -d '{"body": "Use EventDates.ForeclosureSaleDate for the auction date. This is the canonical source."}' | jq .
```

If no open questions exist, skip to Step 3.

**Step 2: Verify question appears in EK**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');
const ek = db.prepare(\"
  SELECT content FROM context
  WHERE subcategory = 'entity_knowledge'
  AND entityId = (SELECT id FROM entity WHERE name = 'foreclosure' AND side = 'target')
\").get();
if (ek && ek.content.includes('Resolved Questions')) {
  const idx = ek.content.indexOf('## Resolved Questions');
  console.log(ek.content.substring(idx, idx + 500));
} else {
  console.log('No resolved questions section (may be expected if no questions were resolved)');
}
"
```

**Step 3: Clean up test verdicts**

Reset the test verdicts so they don't pollute the real cycle:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');

// Clear test verdicts on the fields we tested
const testIds = ['{MAPPING_ID_A}', '{MAPPING_ID_B}', '{MAPPING_ID_C}'];
for (const id of testIds) {
  db.prepare('UPDATE field_mapping SET sourceVerdict = NULL, sourceVerdictNotes = NULL, transformVerdict = NULL, transformVerdictNotes = NULL WHERE id = ?').run(id);
}

// Delete test learning records (last 3 created for foreclosure)
const testLearnings = db.prepare(\"
  SELECT id FROM learning
  WHERE entityId = (SELECT id FROM entity WHERE name = 'foreclosure' AND side = 'target')
  ORDER BY createdAt DESC LIMIT 3
\").all();
for (const l of testLearnings) {
  db.prepare('DELETE FROM learning WHERE id = ?').run(l.id);
}

console.log('Cleaned up', testIds.length, 'verdicts and', testLearnings.length, 'test learnings');

// Rebuild EK to remove test data
// (will be done by the real cycle anyway, but keep it clean)
"
```

Then rebuild EK for foreclosure to clear test data:

```bash
cd /Users/rob/code/surveyor
node -e "
// Quick rebuild trigger
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');
const entId = db.prepare(\"SELECT id FROM entity WHERE name = 'foreclosure' AND side = 'target'\").get().id;
const wsId = db.prepare('SELECT DISTINCT workspaceId FROM entity LIMIT 1').get().workspaceId;
console.log('Entity:', entId, 'Workspace:', wsId);
// The rebuild will happen naturally on next auto-verdict run
console.log('Test data cleaned. EK will rebuild during auto-verdicts run.');
"
```

**Step 4: Commit validation results**

Document what you observed — did the MANDATORY phrasing appear? Did the EK section header change? No code commit needed, just confirm the pipeline works.

---

### Task 9: Check BigQuery for missing source tables

**Step 1: Query BigQuery for the three tables**

```bash
cd /Users/rob/code/mapping-engine
python3 -c "
import subprocess, json

tables = ['LSMTPlanTypes', 'ExistingDeceasedBorrower', 'Courts']
project = 'service-mac-prod'
dataset = 'raw_acdc_m1'

for table in tables:
    fqn = f'{project}.{dataset}.{table}'
    result = subprocess.run(
        ['bq', 'show', '--format=json', fqn],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        info = json.loads(result.stdout)
        num_rows = info.get('numRows', '?')
        print(f'  FOUND: {table} ({num_rows} rows)')
    else:
        print(f'  NOT FOUND: {table}')
        # Try case variations
        for variant in [table.lower(), table.upper()]:
            r2 = subprocess.run(['bq', 'show', '--format=json', f'{project}.{dataset}.{variant}'], capture_output=True, text=True)
            if r2.returncode == 0:
                print(f'    BUT FOUND AS: {variant}')
"
```

**Step 2: Based on results, proceed to Task 10 or skip**

- If tables are FOUND → proceed to Task 10
- If tables are NOT FOUND → document in results doc as SOT inaccuracies, skip Task 10

---

### Task 10: Import found source tables (conditional)

Only do this task if tables were found in BigQuery in Task 9.

**Step 1: Add tables to KNOWN_TABLES**

Modify: `/Users/rob/code/mapping-engine/engine/bq_context.py:34-73`

Add the found table names to the `KNOWN_TABLES` list in alphabetical order.

**Step 2: Refresh BQ cache**

```bash
cd /Users/rob/code/mapping-engine
python3 -m engine.cli refresh-bq-context <TABLE_NAMES> --null-rates --values
```

Replace `<TABLE_NAMES>` with space-separated names of found tables.

**Step 3: Verify cache files created**

```bash
ls -la cache/bq_schema/ | grep -iE "lsmt|deceased|court"
```

**Step 4: Re-run Surveyor import**

```bash
cd /Users/rob/code/surveyor
npx tsx scripts/import-all-entities.ts
```

**Step 5: Verify new source entities in Surveyor**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('surveyor.db');
const sources = db.prepare(\"SELECT name, side FROM entity WHERE side = 'source' ORDER BY name\").all();
console.log('Source entities:', sources.length);
sources.forEach(s => console.log(' ', s.name));
"
```

**Step 6: Commit mapping-engine changes**

```bash
cd /Users/rob/code/mapping-engine
git add engine/bq_context.py
git commit -m "feat: add missing ACDC tables to KNOWN_TABLES"
```

---

### Task 11: Run feedback loop cycle 2 — generate + eval

**Step 1: Generate and evaluate all 7 entities**

```bash
cd /Users/rob/code/surveyor
npx tsx scripts/multi-entity-eval.ts
```

This takes ~12-15 min. Watch for:
- `loan` should now produce persisted mappings (Zod fix)
- All 7 entities should show eval scores

**Step 2: Record baseline results**

Copy the summary table output. This is the "cycle 2 baseline" — generated with hardened EK from cycle 1.

---

### Task 12: Run feedback loop cycle 2 — auto-verdicts

**Step 1: Run auto-verdicts with hardened phrasing**

```bash
cd /Users/rob/code/surveyor
npx tsx scripts/auto-verdicts.ts
```

Watch for:
- Verdict count per entity
- Entity Knowledge line counts (confirms EK rebuild)
- `loan` and `loss_mitigation_application` should now get verdicts (they have mappings)

**Step 2: Record verdict counts**

Note how many verdicts per entity and what types.

---

### Task 13: Run feedback loop cycle 2 — regenerate with feedback

**Step 1: Regenerate all 7 entities**

```bash
cd /Users/rob/code/surveyor
npx tsx scripts/multi-entity-eval.ts
```

**Step 2: Record final results and compare**

Compare against:
- Round 1 baseline: 13.5% aggregate
- Round 1 post-feedback: 27.2% aggregate
- Round 2 baseline (Task 11): ?%
- Round 2 post-feedback (this step): ?%

Check specifically:
- Did `loan` get a score? (was 0% due to Zod bug)
- Did the 3 model-override fields follow corrections? (`foreclosure.judgement_entered_date`, `escrow_analysis.current_escrow_balance`, `bankruptcy_case.chapter`)
- Did `loss_mitigation_application` improve further?

**Step 3: Write results doc**

Create `docs/plans/2026-02-27-cycle-2-results.md` with the comparison table and observations.

**Step 4: Commit results**

```bash
git add docs/plans/2026-02-27-cycle-2-results.md
git commit -m "docs: cycle 2 feedback loop results"
```
