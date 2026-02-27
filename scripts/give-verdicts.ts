/**
 * Give verdicts on known-wrong fields for loss_mitigation_loan_modification.
 * This simulates what a reviewer would do in the discuss UI.
 *
 * Usage: npx tsx scripts/give-verdicts.ts
 */
import { db } from "../src/lib/db";
import { fieldMapping, field, entity } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { extractVerdictLearning } from "../src/lib/generation/mapping-learning";

const WORKSPACE_ID = "2ac4e497-1c82-4b0d-a86e-83bec30761c8";
const ENTITY_NAME = "loss_mitigation_loan_modification";

// Get entity ID
const targetEntity = db
  .select({ id: entity.id })
  .from(entity)
  .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, ENTITY_NAME)))
  .get();

if (!targetEntity) {
  console.log("Entity not found");
  process.exit(1);
}

// Get all latest mappings for this entity with field names
const mappings = db
  .select({
    mappingId: fieldMapping.id,
    targetFieldName: field.name,
    sourceEntityName: entity.name,
  })
  .from(fieldMapping)
  .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
  .leftJoin(entity, eq(fieldMapping.sourceEntityId, entity.id))
  .where(
    and(
      eq(fieldMapping.workspaceId, WORKSPACE_ID),
      eq(fieldMapping.isLatest, true),
      eq(field.entityId, targetEntity.id),
    )
  )
  .all();

const byField = new Map(mappings.map((m) => [m.targetFieldName, m]));

// Verdict 1: trial_period_date_first_payment_due — wrong_table
// gen=EventDates.FpFirstPaymentDueDate, SOT=DefaultWorkstations.ModTrialStartDate
const v1 = byField.get("trial_period_date_first_payment_due");
if (v1) {
  db.update(fieldMapping)
    .set({
      sourceVerdict: "wrong_table",
      sourceVerdictNotes: "Should be DefaultWorkstations.ModTrialStartDate, not EventDates.FpFirstPaymentDueDate",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(fieldMapping.id, v1.mappingId))
    .run();
  extractVerdictLearning(WORKSPACE_ID, v1.mappingId);
  console.log("✓ trial_period_date_first_payment_due → wrong_table");
}

// Verdict 2: trial_period_date_last_payment_due — wrong_table
// gen=EventDates.FpLastPaymentDueDate, SOT=DefaultWorkstations.ModTrialEndDate
const v2 = byField.get("trial_period_date_last_payment_due");
if (v2) {
  db.update(fieldMapping)
    .set({
      sourceVerdict: "wrong_table",
      sourceVerdictNotes: "Should be DefaultWorkstations.ModTrialEndDate, not EventDates.FpLastPaymentDueDate",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(fieldMapping.id, v2.mappingId))
    .run();
  extractVerdictLearning(WORKSPACE_ID, v2.mappingId);
  console.log("✓ trial_period_date_last_payment_due → wrong_table");
}

// Verdicts 3-7: unmapped fields that should map to Step.ActualCompletionDate
const unmappedFields = [
  "agreement_executed_date",
  "agreement_received_from_homeowner_date",
  "agreement_recorded_date",
  "agreement_sent_to_homeowner_date",
  "plan_booked_date",
];

for (const fieldName of unmappedFields) {
  const m = byField.get(fieldName);
  if (m) {
    db.update(fieldMapping)
      .set({
        sourceVerdict: "missing_source",
        sourceVerdictNotes: "Should map to Step.ActualCompletionDate (step-based date field)",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(fieldMapping.id, m.mappingId))
      .run();
    extractVerdictLearning(WORKSPACE_ID, m.mappingId);
    console.log(`✓ ${fieldName} → missing_source`);
  } else {
    console.log(`⚠ ${fieldName} — no mapping found (may be truly unmapped with no mapping row)`);
  }
}

// Check Entity Knowledge was rebuilt
import { context } from "../src/lib/db/schema";
const ek = db
  .select({ content: context.content, updatedAt: context.updatedAt })
  .from(context)
  .where(
    and(
      eq(context.workspaceId, WORKSPACE_ID),
      eq(context.subcategory, "entity_knowledge"),
      eq(context.entityId, targetEntity.id),
    )
  )
  .get();

if (ek) {
  const lines = ek.content?.split("\n").length ?? 0;
  console.log(`\nEntity Knowledge doc: ${lines} lines, updated ${ek.updatedAt}`);
  console.log("First 500 chars:");
  console.log(ek.content?.slice(0, 500));
} else {
  console.log("\n⚠ No Entity Knowledge doc found");
}
