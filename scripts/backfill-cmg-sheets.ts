#!/usr/bin/env npx tsx
/**
 * Backfill CMG transfer with missing sheets (Pay Histories + Escrow Line Detail).
 *
 * CMG's source-layout.xlsx has 3 sheets but only the first was imported.
 * This script adds fields from sheets 2 and 3 (prefixed with sheet slug)
 * to the existing CMG source entity, then regenerates source-fields.csv.
 *
 * Usage:
 *   npx tsx scripts/backfill-cmg-sheets.ts [--dry-run]
 */

import { db } from "../src/lib/db";
import { transfer, entity, field } from "../src/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { writeFileSync } from "fs";
import { join } from "path";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`=== Backfill CMG missing sheets${dryRun ? " (DRY RUN)" : ""} ===\n`);

  // 1. Find CMG transfer
  const [cmg] = await db
    .select()
    .from(transfer)
    .where(eq(transfer.name, "CMG"));

  if (!cmg) {
    console.error("CMG transfer not found");
    process.exit(1);
  }
  console.log(`Transfer: ${cmg.name} (${cmg.id})`);

  // 2. Find existing source entity
  const sourceEntities = await db
    .select()
    .from(entity)
    .where(
      and(
        eq(entity.schemaAssetId, cmg.sourceSchemaAssetId!),
        eq(entity.side, "source"),
      )
    );

  if (sourceEntities.length === 0) {
    console.error("No source entity found for CMG");
    process.exit(1);
  }
  const sourceEntity = sourceEntities[0];
  console.log(`Source entity: ${sourceEntity.displayName} (${sourceEntity.id})`);

  // 3. Load existing field names
  const existingFields = await db
    .select({ name: field.name })
    .from(field)
    .where(eq(field.entityId, sourceEntity.id));
  const existingNames = new Set(existingFields.map((f) => f.name));
  console.log(`Existing fields: ${existingNames.size}`);

  // 4. Read sheets 2 and 3 from Excel
  const XLSX = require("xlsx");
  const wb = XLSX.readFile("data/transfers/cmg/source-layout.xlsx");
  console.log(`\nSheets: ${wb.SheetNames.join(", ")}`);

  const newFields: { name: string; position: number; sampleValues: string[] }[] = [];
  let globalPosition = existingNames.size; // continue numbering after existing fields

  for (let i = 1; i < wb.SheetNames.length; i++) {
    const sheetName = wb.SheetNames[i];
    const ws = wb.Sheets[sheetName];
    const data: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const headers = (data[0] || []).map(String);
    const dataRows = data.slice(1).map((row: unknown[]) => row.map(String));

    const sheetSlug = sheetName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");

    console.log(`\n${sheetName} (${sheetSlug}): ${headers.length} columns, ${dataRows.length} data rows`);

    for (let col = 0; col < headers.length; col++) {
      const rawName = String(headers[col] || "").trim();
      if (!rawName) continue;

      const prefixedName = `${sheetSlug}.${rawName}`;

      // Skip if already exists (with or without prefix)
      if (existingNames.has(prefixedName) || existingNames.has(rawName)) {
        // Still add prefixed version if only unprefixed exists (for disambiguation)
        if (existingNames.has(rawName) && !existingNames.has(prefixedName)) {
          // Collect samples
          const seen = new Set<string>();
          const samples: string[] = [];
          for (const row of dataRows) {
            const val = String(row[col] ?? "").trim();
            if (!val || val === "null" || val === "undefined" || val === "NULL") continue;
            if (seen.has(val)) continue;
            seen.add(val);
            samples.push(val);
            if (samples.length >= 5) break;
          }

          newFields.push({ name: prefixedName, position: globalPosition++, sampleValues: samples });
          console.log(`  + ${prefixedName} (also in sheet 1 as ${rawName})`);
        }
        continue;
      }

      // Collect unique sample values
      const seen = new Set<string>();
      const samples: string[] = [];
      for (const row of dataRows) {
        const val = String(row[col] ?? "").trim();
        if (!val || val === "null" || val === "undefined" || val === "NULL") continue;
        if (seen.has(val)) continue;
        seen.add(val);
        samples.push(val);
        if (samples.length >= 5) break;
      }

      newFields.push({ name: prefixedName, position: globalPosition++, sampleValues: samples });
      console.log(`  + ${prefixedName}`);
    }
  }

  console.log(`\nNew fields to add: ${newFields.length}`);

  if (dryRun) {
    console.log("\nDry run — no changes made.");
    process.exit(0);
  }

  // 5. Insert new fields
  const BATCH_SIZE = 50;
  for (let i = 0; i < newFields.length; i += BATCH_SIZE) {
    const batch = newFields.slice(i, i + BATCH_SIZE);
    await db.insert(field).values(
      batch.map((f) => ({
        entityId: sourceEntity.id,
        name: f.name,
        displayName: f.name,
        position: f.position,
        sampleValues: f.sampleValues.length > 0 ? f.sampleValues : null,
      }))
    );
  }
  console.log(`Inserted ${newFields.length} new source fields`);

  // 6. Regenerate source-fields.csv
  const allFields = await db
    .select({ name: field.name, position: field.position, sampleValues: field.sampleValues })
    .from(field)
    .where(eq(field.entityId, sourceEntity.id));

  allFields.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  let csv = "position,field_name,sample_value\n";
  for (const f of allFields) {
    const samples = (f.sampleValues as string[]) || [];
    let quotedName = f.name;
    let quotedSample = samples[0] || "";
    if (quotedName.includes(",") || quotedName.includes('"')) {
      quotedName = '"' + quotedName.replace(/"/g, '""') + '"';
    }
    if (quotedSample.includes(",") || quotedSample.includes('"')) {
      quotedSample = '"' + quotedSample.replace(/"/g, '""') + '"';
    }
    csv += `${f.position},${quotedName},${quotedSample}\n`;
  }

  const csvPath = join("data/transfers/cmg", "source-fields.csv");
  writeFileSync(csvPath, csv);
  console.log(`Updated: ${csvPath} (${allFields.length} total fields)`);

  // 7. Update entity description
  await db
    .update(entity)
    .set({
      description: `${allFields.length}-field flat file from CMG servicing transfer (3 sheets: Service Release, Pay Histories, Escrow Line Detail)`,
    })
    .where(eq(entity.id, sourceEntity.id));

  console.log(`\nDone. Next: re-run generation for escrow-domain fields:`);
  console.log(`  npx tsx scripts/run-transfer-generation.ts --transfer-id ${cmg.id} --domain escrow --dry-run`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
