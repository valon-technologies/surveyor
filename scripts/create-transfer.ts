#!/usr/bin/env npx tsx
/**
 * Create a transfer record from a source file.
 *
 * Supports multiple input formats:
 *   1. Pre-parsed source-fields.csv (position, field_name, sample_value)
 *   2. Raw data CSV with headers + data rows (extracts unique sample values)
 *   3. Raw data xlsx with headers in row 1 + data rows below
 *
 * For raw data files, generates source-fields.csv in the same directory.
 *
 * Usage:
 *   npx tsx scripts/create-transfer.ts --name "MISMO" --source data/transfers/mismo/source-layout.csv
 *   npx tsx scripts/create-transfer.ts --name "Premier" --source data/transfers/premier/source-layout.xlsx
 *   npx tsx scripts/create-transfer.ts --name "Premier" --csv data/transfers/premier/source-fields.csv  # legacy
 */

import { db } from "../src/lib/db";
import {
  transfer,
  schemaAsset,
  entity,
  field,
  workspace,
  userWorkspace,
} from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { parseTransferSourceCSV } from "../src/lib/import/transfer-source-parser";

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const name = getArg("--name");
const sourcePath = getArg("--source") || getArg("--csv");
const maxSamples = parseInt(getArg("--max-samples") || "5", 10);

if (!name || !sourcePath) {
  console.error(`Usage: npx tsx scripts/create-transfer.ts --name "MISMO" --source <file> [options]

Options:
  --source <file>       Source file: .csv (raw data or source-fields.csv), .xlsx
  --csv <file>          Legacy alias for --source (pre-parsed source-fields.csv only)
  --name <name>         Transfer name
  --max-samples <n>     Max unique sample values per field (default: 5)`);
  process.exit(1);
}

// ─── Parsing helpers ──────────────────────────────────────

interface ParsedField {
  position: number;
  fieldName: string;
  sampleValues: string[];
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Detect whether a CSV is a pre-parsed source-fields.csv or raw data.
 * source-fields.csv has headers: position, field_name, sample_value
 */
function isSourceFieldsCSV(headers: string[]): boolean {
  const normalized = headers.map(h => h.toLowerCase().trim());
  return (
    normalized.includes("field_name") || normalized.includes("fieldname")
  ) && (
    normalized.includes("position") || normalized.includes("pos")
  );
}

/**
 * Parse a raw data CSV/xlsx into field definitions with multiple sample values.
 * Headers come from row 0, sample values are collected from data rows.
 */
function parseRawData(headers: string[], dataRows: string[][]): ParsedField[] {
  const fields: ParsedField[] = [];

  for (let col = 0; col < headers.length; col++) {
    const fieldName = String(headers[col] || "").trim();
    if (!fieldName) continue;

    // Collect unique non-empty sample values from data rows
    const seen = new Set<string>();
    const samples: string[] = [];
    for (const row of dataRows) {
      const val = String(row[col] ?? "").trim();
      if (!val || val === "null" || val === "undefined" || val === "NULL") continue;
      if (seen.has(val)) continue;
      seen.add(val);
      samples.push(val);
      if (samples.length >= maxSamples) break;
    }

    fields.push({
      position: col,
      fieldName,
      sampleValues: samples,
    });
  }

  return fields;
}

/**
 * Write source-fields.csv with multiple sample values.
 * Format: position,field_name,sample_value (first sample for compat),
 *         plus sample_values column with pipe-delimited extras.
 */
function writeSourceFieldsCSV(fields: ParsedField[], outputPath: string): void {
  let csv = "position,field_name,sample_value\n";
  for (const f of fields) {
    const sample = f.sampleValues[0] || "";
    let quotedName = f.fieldName;
    let quotedSample = sample;
    if (quotedName.includes(",") || quotedName.includes('"')) {
      quotedName = '"' + quotedName.replace(/"/g, '""') + '"';
    }
    if (quotedSample.includes(",") || quotedSample.includes('"')) {
      quotedSample = '"' + quotedSample.replace(/"/g, '""') + '"';
    }
    csv += `${f.position},${quotedName},${quotedSample}\n`;
  }
  writeFileSync(outputPath, csv);
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log(`=== Create Transfer: ${name} ===\n`);

  // 1. Parse source file
  let fields: ParsedField[];
  const ext = extname(sourcePath).toLowerCase();
  const dir = dirname(sourcePath);
  const sourceFieldsPath = join(dir, "source-fields.csv");

  if (ext === ".xlsx" || ext === ".xls") {
    // Excel file — iterate ALL sheets, prefix field names with sheet slug for multi-sheet files
    const XLSX = require("xlsx");
    const wb = XLSX.readFile(sourcePath);
    const multiSheet = wb.SheetNames.length > 1;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const data: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const headers = (data[0] || []).map(String);
      const dataRows = data.slice(1).map((row: unknown[]) => row.map(String));
      if (headers.length === 0) continue;

      // For multi-sheet files, prefix field names with a sheet slug (e.g., "escrow_line_detail.FIELD")
      const sheetSlug = sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
      const sheetFields = parseRawData(headers, dataRows).map(f => ({
        ...f,
        fieldName: multiSheet ? `${sheetSlug}.${f.fieldName}` : f.fieldName,
      }));

      console.log(`Excel: ${sheetName} — ${headers.length} columns, ${dataRows.length} data rows → ${sheetFields.length} fields${multiSheet ? ` (prefix: ${sheetSlug})` : ""}`);
      fields.push(...sheetFields);
    }

    writeSourceFieldsCSV(fields, sourceFieldsPath);
    console.log(`Generated: ${sourceFieldsPath} (${fields.length} total fields)`);
  } else if (ext === ".csv") {
    // CSV — detect if pre-parsed or raw data
    const raw = readFileSync(sourcePath, "utf-8");
    const lines = raw.split("\n").map(l => l.replace(/\r$/, "")).filter(l => l.trim());
    const headers = parseCSVLine(lines[0]);

    if (isSourceFieldsCSV(headers)) {
      // Pre-parsed source-fields.csv
      console.log("Detected pre-parsed source-fields.csv format");
      const parsed = parseTransferSourceCSV(raw);
      fields = parsed.fields.map(f => ({
        position: f.position,
        fieldName: f.fieldName,
        sampleValues: f.sampleValue ? [f.sampleValue] : [],
      }));
    } else {
      // Raw data CSV
      const dataRows = lines.slice(1).map(l => parseCSVLine(l));
      console.log(`Raw CSV: ${headers.length} columns, ${dataRows.length} data rows`);
      fields = parseRawData(headers.map(h => h.trim()), dataRows);
      writeSourceFieldsCSV(fields, sourceFieldsPath);
      console.log(`Generated: ${sourceFieldsPath}`);
    }
  } else {
    console.error(`Unsupported file type: ${ext}`);
    process.exit(1);
  }

  console.log(`Fields: ${fields.length}`);
  const withSamples = fields.filter(f => f.sampleValues.length > 0);
  console.log(`Fields with sample values: ${withSamples.length}/${fields.length}`);

  // 2. Find workspace
  const [ws] = await db.select().from(workspace).limit(1);
  if (!ws) { console.error("No workspace found"); process.exit(1); }
  console.log(`\nWorkspace: ${ws.name} (${ws.id})`);

  const [member] = await db
    .select()
    .from(userWorkspace)
    .where(eq(userWorkspace.workspaceId, ws.id))
    .limit(1);
  if (!member) { console.error("No workspace member found"); process.exit(1); }

  // 3. Check if already exists
  const [existing] = await db
    .select({ id: transfer.id })
    .from(transfer)
    .where(and(eq(transfer.workspaceId, ws.id), eq(transfer.name, name!)));
  if (existing) {
    console.log(`Transfer "${name}" already exists: ${existing.id}`);
    process.exit(0);
  }

  // 4. Create schema asset
  const sourceContent = existsSync(sourceFieldsPath)
    ? readFileSync(sourceFieldsPath, "utf-8").slice(0, 1000)
    : "";
  const [asset] = await db.insert(schemaAsset).values({
    workspaceId: ws.id,
    name: `${name} Source File`,
    side: "source",
    format: "csv",
    rawContent: sourceContent,
  }).returning();
  console.log(`Schema asset: ${asset.id}`);

  // 5. Create source entity
  const entitySlug = name!.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_flat_file";
  const [sourceEntity] = await db.insert(entity).values({
    workspaceId: ws.id,
    schemaAssetId: asset.id,
    name: entitySlug,
    displayName: `${name} Flat File`,
    side: "source",
    description: `${fields.length}-field flat file from ${name} servicing transfer`,
  }).returning();
  console.log(`Source entity: ${sourceEntity.id}`);

  // 6. Create source fields (batch insert for speed)
  const BATCH_SIZE = 50;
  for (let i = 0; i < fields.length; i += BATCH_SIZE) {
    const batch = fields.slice(i, i + BATCH_SIZE);
    await db.insert(field).values(
      batch.map(f => ({
        entityId: sourceEntity.id,
        name: f.fieldName,
        displayName: f.fieldName,
        position: f.position,
        sampleValues: f.sampleValues.length > 0 ? f.sampleValues : null,
      }))
    );
  }
  console.log(`Created ${fields.length} source fields`);

  // 7. Create transfer
  const [t] = await db.insert(transfer).values({
    workspaceId: ws.id,
    name: name!,
    clientName: name!,
    description: `Flow servicing transfer mapping for ${name} portfolio (${fields.length} source fields)`,
    status: "ready",
    sourceSchemaAssetId: asset.id,
    stats: { totalSourceFields: fields.length },
    createdBy: member.userId,
  }).returning();

  console.log(`\nTransfer created: ${t.id}`);
  console.log(`\nNext steps:`);
  console.log(`  npx tsx scripts/run-transfer-generation.ts --transfer-id ${t.id} --dry-run`);
  console.log(`  npx tsx scripts/run-transfer-generation.ts --transfer-id ${t.id}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
