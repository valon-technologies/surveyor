#!/usr/bin/env npx tsx
/**
 * Quick local test: creates a transfer from Stockton data, verifies DB records.
 * Bypasses auth — talks directly to DB.
 *
 * Usage: npx tsx scripts/test-transfer-flow.ts
 */

import { db } from "../src/lib/db";
import {
  transfer,
  transferCorrection,
  schemaAsset,
  entity,
  field,
  workspace,
  userWorkspace,
} from "../src/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { readFileSync } from "fs";
import { parseTransferSourceCSV, parseRequirementCSV } from "../src/lib/import/transfer-source-parser";
import { matchRequirementType } from "../src/lib/transfer/requirement-matcher";

async function main() {
  console.log("=== Transfer Flow Test ===\n");

  // 1. Find the workspace and user
  const [ws] = await db.select().from(workspace).limit(1);
  if (!ws) { console.error("No workspace found"); process.exit(1); }
  console.log(`Workspace: ${ws.name} (${ws.id})`);

  const [member] = await db
    .select()
    .from(userWorkspace)
    .where(eq(userWorkspace.workspaceId, ws.id))
    .limit(1);
  if (!member) { console.error("No workspace member found"); process.exit(1); }
  console.log(`User: ${member.userId}`);

  // 2. Parse source file
  const sourceCSV = readFileSync("/Users/rob/code/servicing-transfer-mapping/stockton-fields.csv", "utf-8");
  const parsed = parseTransferSourceCSV(sourceCSV);
  console.log(`\nParsed source: ${parsed.totalFields} fields`);
  console.log(`  First: [${parsed.fields[0].position}] ${parsed.fields[0].fieldName} (${parsed.fields[0].sampleValue})`);
  console.log(`  Last:  [${parsed.fields[parsed.fields.length - 1].position}] ${parsed.fields[parsed.fields.length - 1].fieldName}`);

  // 3. Parse requirement data
  const reqCSV = readFileSync("/Users/rob/code/servicing-transfer-mapping/data-dict-required-fields.csv", "utf-8");
  const reqs = parseRequirementCSV(reqCSV);
  console.log(`\nParsed requirements: ${reqs.fields.length} fields`);
  const always = reqs.fields.filter(f => f.requirementType === "ALWAYS_REQUIRED").length;
  const cond = reqs.fields.filter(f => f.requirementType === "CONDITIONALLY_REQUIRED").length;
  console.log(`  Always required: ${always}, Conditionally: ${cond}`);

  // 4. Test requirement matcher
  const testCases = [
    { entity: "loan", field: "loan_number" },
    { entity: "borrower", field: "first_name" },
    { entity: "property", field: "property_type" },
    { entity: "arm_loan_info", field: "arm_index_type" },
  ];
  console.log("\nRequirement matching test:");
  for (const tc of testCases) {
    const match = matchRequirementType(tc.entity, tc.field, reqs.lookup);
    console.log(`  ${tc.entity}.${tc.field}: ${match ? `${match.requirementType}` : "(no match)"}`);
  }

  // 5. Create a transfer record
  console.log("\n--- Creating transfer in DB ---");
  const [existing] = await db
    .select({ id: transfer.id })
    .from(transfer)
    .where(and(eq(transfer.workspaceId, ws.id), eq(transfer.name, "Stockton Test")));

  let transferId: string;
  if (existing) {
    transferId = existing.id;
    console.log(`Transfer already exists: ${transferId}`);
  } else {
    // Create schema asset for source
    const [asset] = await db.insert(schemaAsset).values({
      workspaceId: ws.id,
      name: "Stockton Source File",
      side: "source",
      format: "csv",
      rawContent: sourceCSV.slice(0, 1000), // store preview
    }).returning();

    // Create source entity
    const [sourceEntity] = await db.insert(entity).values({
      workspaceId: ws.id,
      schemaAssetId: asset.id,
      name: "stockton_flat_file",
      displayName: "Stockton Flat File",
      side: "source",
      description: "440-field flat file from Stockton servicing transfer",
    }).returning();

    // Create source fields
    for (const f of parsed.fields) {
      await db.insert(field).values({
        entityId: sourceEntity.id,
        name: f.fieldName,
        displayName: f.fieldName,
        position: f.position,
        sampleValues: f.sampleValue ? [f.sampleValue] : null,
      });
    }

    // Create transfer
    const [t] = await db.insert(transfer).values({
      workspaceId: ws.id,
      name: "Stockton Test",
      clientName: "Stockton",
      description: "Test transfer for Stockton servicing data",
      status: "ready",
      sourceSchemaAssetId: asset.id,
      stats: {
        totalSourceFields: parsed.totalFields,
      },
      createdBy: member.userId,
    }).returning();

    transferId = t.id;
    console.log(`Created transfer: ${transferId}`);
    console.log(`  Source entity: ${sourceEntity.id}`);
    console.log(`  Schema asset: ${asset.id}`);
  }

  // 6. Verify records
  const [sourceFieldCount] = await db
    .select({ count: count() })
    .from(field)
    .innerJoin(entity, eq(field.entityId, entity.id))
    .innerJoin(schemaAsset, eq(entity.schemaAssetId, schemaAsset.id))
    .innerJoin(transfer, eq(schemaAsset.id, transfer.sourceSchemaAssetId))
    .where(eq(transfer.id, transferId));

  console.log(`\n=== Verification ===`);
  console.log(`Source fields in DB: ${sourceFieldCount?.count ?? 0}`);

  // 7. Count corrections
  const [corrCount] = await db
    .select({ count: count() })
    .from(transferCorrection)
    .where(eq(transferCorrection.transferId, transferId));
  console.log(`Corrections: ${corrCount?.count ?? 0}`);

  console.log(`\nTransfer ID for feedback import: ${transferId}`);
  console.log("\nTo import feedback, run:");
  console.log(`  npx tsx scripts/import-transfer-feedback.ts --transfer-id ${transferId} --dry-run`);

  console.log("\n=== Test complete ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
