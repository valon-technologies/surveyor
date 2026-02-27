/**
 * Quick SOT eval runner for loss_mitigation_loan_modification.
 * Usage: npx tsx scripts/run-eval.ts
 */
import { evaluateEntityMappings } from "../src/lib/evaluation/mapping-evaluator";

const WORKSPACE_ID = "2ac4e497-1c82-4b0d-a86e-83bec30761c8";
const ENTITY_ID = "07d0678a-637e-4917-9099-bd6ce09622dc";

const result = evaluateEntityMappings(WORKSPACE_ID, ENTITY_ID);
if (!result) {
  console.log("No SOT data");
  process.exit(1);
}

console.log(`Score: ${result.sourceExactPct}% exact (${result.sourceExactCount}/${result.scoredFields})`);
console.log(`Lenient: ${result.sourceLenientPct}%`);
console.log("");

const ORDER: Record<string, number> = {
  DISJOINT: 0, NO_GEN: 1, OVERLAP: 2, SUBSET: 3, SUPERSET: 4,
  EXACT: 5, BOTH_NULL: 6, SOT_NULL: 7, NO_SOT: 8,
};

const sorted = result.fieldResults.sort(
  (a, b) => (ORDER[a.matchType] ?? 9) - (ORDER[b.matchType] ?? 9)
);

for (const r of sorted) {
  if (r.matchType === "NO_SOT" || r.matchType === "SOT_NULL") continue;
  const gen = r.genSources.join(", ") || "(unmapped)";
  const sot = r.sotSources.join(", ") || "(none)";
  console.log(
    r.matchType.padEnd(12),
    r.field.padEnd(50),
    ("gen=" + gen).padEnd(65),
    "sot=" + sot
  );
}
