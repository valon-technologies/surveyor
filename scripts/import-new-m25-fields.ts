/**
 * Import new M2.5 fields from Linear into Surveyor.
 * Uses parent issue as entity, field description for metadata.
 *
 * Usage: npx tsx --env-file=.env.local scripts/import-new-m25-fields.ts
 */
import { db } from "../src/lib/db";
import { entity, field } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

// Mapping from Linear parent issue title (entity) → fields
// Sourced from Linear GQL query with parent resolution
const NEW_FIELDS: { entityName: string; fieldName: string; linearId: string; dataType: string | null; description: string; enumValues: string[] | null }[] = [
  { entityName: "bankruptcy_case_loan_detail", fieldName: "active_plan_id", linearId: "MAP-792", dataType: "string", description: "Foreign key to the active bankruptcy plan", enumValues: null },
  { entityName: "loss_mitigation_request_final_underwriting", fieldName: "amount", linearId: "MAP-809", dataType: "double", description: "The dollar amount for the underwriting category", enumValues: null },
  { entityName: "loss_mitigation_application_completeness_evaluation", fieldName: "application_completeness_decision", linearId: "MAP-805", dataType: "string", description: "Completeness decision for the application", enumValues: ["COMPLETE", "INCOMPLETE"] },
  { entityName: "mortgage_assistance_application_to_application_individual", fieldName: "application_id", linearId: "MAP-803", dataType: "string", description: "The loss mitigation application associated with the application individual", enumValues: null },
  { entityName: "loss_mitigation_plan_evaluation", fieldName: "application_plan_evaluation_id", linearId: "MAP-798", dataType: "string", description: "The associated submission input that triggered this plan evaluation execution", enumValues: null },
  { entityName: "property_conveyance_attempt", fieldName: "attempt_status", linearId: "MAP-790", dataType: "string", description: "Current status of the conveyance attempt", enumValues: ["IN_PROGRESS", "CONVEYANCE_READY", "ACCEPTED", "RECONVEYED"] },
  { entityName: "loan_accounting_balance", fieldName: "bankruptcy_pre_petition_arrearage_escrow_shortage_balance", linearId: "MAP-100", dataType: "double", description: "Post-transaction escrow shortage prior to petition", enumValues: null },
  { entityName: "loan_accounting_balance", fieldName: "bankruptcy_pre_petition_arrearage_fee_late_balance", linearId: "MAP-102", dataType: "double", description: "Post-transaction late fees pre-petition", enumValues: null },
  { entityName: "loan_accounting_balance", fieldName: "bankruptcy_pre_petition_arrearage_principal_and_interest_balance", linearId: "MAP-105", dataType: "double", description: "Post-transaction pre-petition principal and interest balance", enumValues: null },
  { entityName: "loss_mitigation_request_final_underwriting", fieldName: "category", linearId: "MAP-810", dataType: "string", description: "The underwriting category", enumValues: ["ASSET", "EXPENSE", "INCOME"] },
  { entityName: "reo_unit_detail", fieldName: "eviction_completed_date", linearId: "MAP-788", dataType: "date", description: "Date the eviction was completed", enumValues: null },
  { entityName: "foreclosure", fieldName: "final_judgment_entered_date", linearId: "MAP-797", dataType: "date", description: "The date when the final judgment was entered by the court", enumValues: null },
  { entityName: "loss_mitigation_hardship", fieldName: "hardship_type", linearId: "MAP-780", dataType: "string", description: "Hardship type", enumValues: ["BORROWERS_SEPARATION", "COVID_19", "DEATH", "DISABILITY", "DISASTER", "DIVORCE_OR_LEGAL_SEPARATION", "EMPLOYMENT_RELOCATION", "HOUSING_EXPENSE_INCREASE", "INCOME_DECREASE", "INCREASED_PAYMENT_LOAN_MODIFICATION", "MILITARY_SERVICE", "OTHER", "PROPERTY_DAMAGE"] },
  { entityName: "mortgage_assistance_application_to_application_individual", fieldName: "individual_id", linearId: "MAP-804", dataType: "string", description: "The individual associated with the loss mitigation application", enumValues: null },
  { entityName: "loss_mitigation_hardship", fieldName: "linked_entity_type", linearId: "MAP-815", dataType: "string", description: "Linked entity type", enumValues: null },
  { entityName: "loss_mitigation_request_final_underwriting", fieldName: "loan_id", linearId: "MAP-811", dataType: "string", description: "The loan associated with the Loss Mitigation Request", enumValues: null },
  { entityName: "real_estate_owned", fieldName: "loan_id", linearId: "MAP-802", dataType: "string", description: "Unique identifier for the associated loan", enumValues: null },
  { entityName: "loss_mitigation_request_final_underwriting", fieldName: "loss_mitigation_application_id", linearId: "MAP-812", dataType: "string", description: "Loss Mitigation application", enumValues: null },
  { entityName: "loss_mitigation_application_completeness_evaluation", fieldName: "loss_mitigation_application_id", linearId: "MAP-806", dataType: "string", description: "The Loss Mitigation application being reviewed", enumValues: null },
  { entityName: "loss_mitigation_plan_evaluation", fieldName: "loss_mitigation_application_id", linearId: "MAP-799", dataType: "string", description: "The loss mitigation application associated with this evaluation execution", enumValues: null },
  { entityName: "loss_mitigation_request_final_underwriting", fieldName: "loss_mitigation_application_individual_id", linearId: "MAP-813", dataType: "string", description: "The individual that the underwriting values are associated to on the application", enumValues: null },
  { entityName: "loss_mitigation_application_completeness_evaluation", fieldName: "loss_mitigation_request_id", linearId: "MAP-807", dataType: "string", description: "The Loss Mitigation request associated with this review", enumValues: null },
  { entityName: "loss_mitigation_plan_evaluation", fieldName: "loss_mitigation_request_id", linearId: "MAP-801", dataType: "string", description: "The loss mitigation request this evaluation execution belongs to", enumValues: null },
  { entityName: "loss_mitigation_application_completeness_evaluation", fieldName: "notification_event_id", linearId: "MAP-808", dataType: "string", description: "The associated notification to the applicant regarding their application completeness evaluation", enumValues: null },
  { entityName: "loss_mitigation_partial_claim", fieldName: "payment_plan_id", linearId: "MAP-816", dataType: "string", description: "Reference to any related payment plan used in conjunction with the partial claim", enumValues: null },
  { entityName: "property_conveyance_deadline", fieldName: "real_estate_owned_id", linearId: "MAP-817", dataType: "string", description: "Unique identifier for the associated real estate owned record", enumValues: null },
  { entityName: "reo_unit_detail", fieldName: "reo_property_detail_id", linearId: "MAP-787", dataType: "string", description: "Foreign key to the REO property detail record", enumValues: null },
  { entityName: "bankruptcy_case_filing", fieldName: "response_to_filing_id", linearId: "MAP-793", dataType: "string", description: "Reference to the response filing", enumValues: null },
  { entityName: "loss_mitigation_request_final_underwriting", fieldName: "subcategory", linearId: "MAP-814", dataType: "string", description: "The underwriting subcategory", enumValues: null },
  { entityName: "loss_mitigation_plan_evaluation", fieldName: "loss_mitigation_plan_id", linearId: "MAP-800", dataType: "string", description: "The loss mitigation plan created as a result of a passing evaluation", enumValues: null },
];

async function main() {
  const [first] = await db.select().from(entity).limit(1);
  if (!first) { console.error("No entities"); process.exit(1); }
  const WORKSPACE_ID = first.workspaceId;

  // Create missing entities
  const MISSING_ENTITIES = [
    { name: "loss_mitigation_application_completeness_evaluation", description: "Tracks completeness evaluation of loss mitigation applications", domainTags: ["loss_mitigation"] },
    { name: "mortgage_assistance_application_to_application_individual", description: "Links mortgage assistance applications to individual applicants", domainTags: ["loss_mitigation"] },
  ];

  for (const ent of MISSING_ENTITIES) {
    const [existing] = await db.select({ id: entity.id }).from(entity)
      .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, ent.name), eq(entity.side, "target")));
    if (existing) {
      console.log(`Entity exists: ${ent.name}`);
      continue;
    }
    // Use the same schemaAssetId as other target entities
    const [ref] = await db.select({ schemaAssetId: entity.schemaAssetId }).from(entity)
      .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.side, "target"))).limit(1);

    await db.insert(entity).values({
      id: randomUUID(),
      workspaceId: WORKSPACE_ID,
      schemaAssetId: ref!.schemaAssetId,
      name: ent.name,
      displayName: ent.name,
      side: "target",
      description: ent.description,
      domainTags: ent.domainTags,
    });
    console.log(`Created entity: ${ent.name}`);
  }

  // Build entity lookup
  const allEntities = await db.select({ id: entity.id, name: entity.name }).from(entity)
    .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.side, "target")));
  const entityByName = new Map(allEntities.map(e => [e.name, e.id]));

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const f of NEW_FIELDS) {
    const entityId = entityByName.get(f.entityName);
    if (!entityId) {
      console.error(`Entity not found: ${f.entityName} (for ${f.fieldName})`);
      errors++;
      continue;
    }

    // Check if field already exists
    const [existing] = await db.select({ id: field.id }).from(field)
      .where(and(eq(field.entityId, entityId), eq(field.name, f.fieldName)));
    if (existing) {
      console.log(`  skip (exists): ${f.entityName}.${f.fieldName}`);
      skipped++;
      continue;
    }

    await db.insert(field).values({
      id: randomUUID(),
      entityId,
      name: f.fieldName,
      displayName: f.fieldName,
      dataType: f.dataType,
      description: f.description,
      isRequired: false,
      isKey: f.fieldName.endsWith("_id"),
      milestone: "M2.5",
      enumValues: f.enumValues,
      metadata: { linearIssueId: f.linearId },
    });
    console.log(`  created: ${f.entityName}.${f.fieldName} (${f.linearId})`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped, ${errors} errors`);
}

main().catch(console.error);
