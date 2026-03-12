#!/usr/bin/env npx tsx
/**
 * Restore retired M2.5 mappings — for fields that have mapping records
 * but none with isLatest=true (Case 2 from the gap analysis).
 *
 * For each gap field, restores the most recently created mapping to isLatest=true.
 *
 * Usage:
 *   npx tsx scripts/restore-retired-m25.ts [--dry-run]
 */

import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, fieldMapping } from "../src/lib/db/schema";
import { eq, and, isNull, inArray, desc } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`=== Restore Retired M2.5 Mappings${dryRun ? " (DRY RUN)" : ""} ===\n`);

  // All M2.5 fields
  const m25Fields = await db
    .select({ id: field.id, name: field.name, entityId: field.entityId })
    .from(field)
    .where(eq(field.milestone, "M2.5"));

  // All SDT mappings
  const allMappings = await db
    .select({
      id: fieldMapping.id,
      targetFieldId: fieldMapping.targetFieldId,
      isLatest: fieldMapping.isLatest,
      status: fieldMapping.status,
      createdAt: fieldMapping.createdAt,
    })
    .from(fieldMapping)
    .where(isNull(fieldMapping.transferId));

  // Group by targetFieldId
  const mappingsByField = new Map<string, typeof allMappings>();
  for (const m of allMappings) {
    const arr = mappingsByField.get(m.targetFieldId) || [];
    arr.push(m);
    mappingsByField.set(m.targetFieldId, arr);
  }

  // Find Case 2 fields: have records but none with isLatest=true
  const entities = await db.select({ id: entity.id, name: entity.name }).from(entity);
  const entityNameById = new Map(entities.map(e => [e.id, e.name]));

  const toRestore: { fieldId: string; fieldName: string; entityName: string; mappingId: string; status: string }[] = [];

  for (const f of m25Fields) {
    const mappings = mappingsByField.get(f.id) || [];
    if (mappings.length === 0) continue; // Case 1 — skip
    if (mappings.some(m => m.isLatest)) continue; // Already has a current mapping

    // Find the most recently created mapping
    const sorted = [...mappings].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const latest = sorted[0];

    toRestore.push({
      fieldId: f.id,
      fieldName: f.name,
      entityName: entityNameById.get(f.entityId) || f.entityId,
      mappingId: latest.id,
      status: latest.status,
    });
  }

  console.log(`Found ${toRestore.length} fields to restore\n`);

  if (dryRun) {
    for (const r of toRestore) {
      console.log(`  ${r.entityName}.${r.fieldName} → restore ${r.mappingId} (${r.status})`);
    }
    console.log("\nDry run — no changes made.");
    process.exit(0);
  }

  // Restore in batches
  const now = new Date().toISOString();
  let restored = 0;

  for (const r of toRestore) {
    await db
      .update(fieldMapping)
      .set({ isLatest: true, changeSummary: "Restored (M2.5 gap fix)", updatedAt: now })
      .where(eq(fieldMapping.id, r.mappingId));
    restored++;
  }

  // Group by entity for summary
  const byEntity: Record<string, number> = {};
  for (const r of toRestore) {
    byEntity[r.entityName] = (byEntity[r.entityName] || 0) + 1;
  }

  console.log("Restored by entity:");
  for (const [eName, count] of Object.entries(byEntity).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${eName}: ${count} fields`);
  }

  console.log(`\nTotal restored: ${restored} fields`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
