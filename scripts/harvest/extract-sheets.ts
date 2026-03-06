/**
 * Google Sheets extraction script for the Context Harvester.
 *
 * Reads pre-downloaded CSV files (M1/M2 tracker spreadsheets) and extracts
 * mapping claims via LLM. The Gestalt Sheets API has a bug with tab-specific
 * ranges, so we work from local CSVs instead.
 *
 * Usage:
 *   1. Download CSVs: M1 Tracker -> data/m1-tracker.csv, M2 Tracker -> data/m2-tracker.csv
 *   2. npx tsx scripts/harvest/extract-sheets.ts [--dry-run]
 */

import { readFileSync, existsSync } from "fs";

// Load .env.local before any other imports that read env
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import { parse as parseCsv } from "papaparse";
import { extractClaims } from "./lib/claim-extractor";
import { resolveEntity, resolveField, getEntityNames } from "./lib/entity-resolver";
import { saveClaims } from "./lib/store";
import type { HarvestedClaim } from "./lib/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const DATA_DIR = "scripts/harvest/data";

interface CsvSpec {
  path: string;
  milestone: "M1" | "M2";
  /** For the population filter: M1 keeps rows != "NO", M2 keeps rows == "YES" */
  populationFilter: (value: string) => boolean;
}

const CSV_SPECS: CsvSpec[] = [
  {
    path: `${DATA_DIR}/m1-tracker.csv`,
    milestone: "M1",
    populationFilter: (v) => v.toUpperCase() !== "NO",
  },
  {
    path: `${DATA_DIR}/m2-tracker.csv`,
    milestone: "M2",
    populationFilter: (v) => v.toUpperCase() === "YES",
  },
];

// ---------------------------------------------------------------------------
// Column discovery
// ---------------------------------------------------------------------------

interface ColumnMap {
  entityCol: number;
  fieldCol: number;
  populationCol: number;
  notesCols: number[];
}

/**
 * Find the actual header row in the CSV. The M1/M2 trackers have a summary row
 * before the real header. We detect the header by looking for a row that contains
 * "population" (case-insensitive) — that's always in the real header.
 */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const joined = rows[i].join(" ").toLowerCase();
    if (joined.includes("population") || joined.includes("vds entity") || joined.includes("vds field")) {
      return i;
    }
  }
  return 0; // fallback to first row
}

function findColumns(headers: string[], milestone: "M1" | "M2"): ColumnMap {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  // Entity column: "vds entity name", "vds table", "combined for vlookup" (entity.field combo)
  let entityCol = lowerHeaders.findIndex((h) => h.includes("vds entity name"));
  if (entityCol === -1) entityCol = lowerHeaders.findIndex((h) => h.includes("vds table"));
  // Fallback: "combined for vlookup" contains entity.field — we'll split on "." later
  if (entityCol === -1) entityCol = lowerHeaders.findIndex((h) => h.includes("combined for vlookup"));

  // Field column: "vds field name"
  let fieldCol = lowerHeaders.findIndex((h) => h.includes("vds field name"));
  if (fieldCol === -1) fieldCol = lowerHeaders.findIndex((h) => h === "field name");

  // Population column
  let populationCol: number;
  if (milestone === "M1") {
    populationCol = lowerHeaders.findIndex((h) => h.includes("m1") && h.includes("population"));
    if (populationCol === -1) populationCol = lowerHeaders.findIndex((h) => h.includes("population"));
  } else {
    populationCol = lowerHeaders.findIndex((h) => h.includes("m2") && h.includes("population"));
    if (populationCol === -1) populationCol = lowerHeaders.findIndex((h) => h.includes("population"));
  }

  // Notes columns: rich set of patterns matching the actual tracker columns
  const notesPatterns = [
    "note", "comment", "logic", "mapping", "question", "answer",
    "response from servicemac", "implementation", "sql logic",
    "acdc", "blocked", "follow up", "internal thread",
    "review comment", "commentary",
  ];
  const notesCols = lowerHeaders
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) =>
      h && i !== entityCol && i !== fieldCol && i !== populationCol &&
      notesPatterns.some((p) => h.includes(p)),
    )
    .map(({ i }) => i);

  return { entityCol, fieldCol, populationCol, notesCols };
}

// ---------------------------------------------------------------------------
// Row grouping
// ---------------------------------------------------------------------------

interface EntityBatch {
  entityName: string;
  rows: string[];
}

function buildBatches(
  data: string[][],
  headers: string[],
  cols: ColumnMap,
  spec: CsvSpec,
): EntityBatch[] {
  const groups = new Map<string, string[]>();

  for (const row of data) {
    // Skip rows with no entity or field
    let rawEntity = cols.entityCol >= 0 ? (row[cols.entityCol] ?? "").trim() : "";
    let rawField = cols.fieldCol >= 0 ? (row[cols.fieldCol] ?? "").trim() : "";

    // Handle "Combined for Vlookup" format: "entity.field"
    if (rawEntity && !rawField && rawEntity.includes(".")) {
      const dotIdx = rawEntity.indexOf(".");
      rawField = rawEntity.slice(dotIdx + 1);
      rawEntity = rawEntity.slice(0, dotIdx);
    }

    if (!rawEntity && !rawField) continue;

    // Apply population filter
    if (cols.populationCol >= 0) {
      const popValue = (row[cols.populationCol] ?? "").trim();
      if (popValue && !spec.populationFilter(popValue)) continue;
    }

    // Gather notes content for this row
    const notesParts: string[] = [];
    if (rawField) notesParts.push(`Field: ${rawField}`);
    for (const ci of cols.notesCols) {
      const val = (row[ci] ?? "").trim();
      if (val) notesParts.push(`${headers[ci]}: ${val}`);
    }
    if (notesParts.length === 0) continue; // nothing useful to extract

    const entityKey = rawEntity || "UNKNOWN";
    if (!groups.has(entityKey)) groups.set(entityKey, []);
    groups.get(entityKey)!.push(notesParts.join("\n"));
  }

  return Array.from(groups.entries()).map(([entityName, rows]) => ({
    entityName,
    rows,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Check that at least one CSV exists
  const availableSpecs = CSV_SPECS.filter((s) => existsSync(s.path));
  if (availableSpecs.length === 0) {
    console.error(
      `No CSV files found. Please download the tracker spreadsheets:\n` +
        `  M1 Tracker -> ${DATA_DIR}/m1-tracker.csv\n` +
        `  M2 Tracker -> ${DATA_DIR}/m2-tracker.csv`,
    );
    process.exit(1);
  }

  const entityNames = await getEntityNames();
  console.log(`Loaded ${entityNames.length} target entity names`);

  const allClaims: HarvestedClaim[] = [];

  for (const spec of availableSpecs) {
    console.log(`\n--- Processing ${spec.path} (${spec.milestone}) ---`);
    const csvText = readFileSync(spec.path, "utf-8");
    const parsed = parseCsv<string[]>(csvText, { header: false, skipEmptyLines: true });

    if (parsed.errors.length > 0) {
      console.warn(`CSV parse warnings for ${spec.path}:`, parsed.errors.slice(0, 3));
    }

    const rows = parsed.data;
    if (rows.length < 2) {
      console.warn(`${spec.path} has fewer than 2 rows, skipping`);
      continue;
    }

    const headerIdx = findHeaderRow(rows);
    const headers = rows[headerIdx];
    const dataRows = rows.slice(headerIdx + 1);
    console.log(`  Header row: ${headerIdx + 1} (0-indexed: ${headerIdx})`);
    const cols = findColumns(headers, spec.milestone);

    console.log(`  Entity column: ${cols.entityCol >= 0 ? headers[cols.entityCol] : "NOT FOUND"}`);
    console.log(`  Field column:  ${cols.fieldCol >= 0 ? headers[cols.fieldCol] : "NOT FOUND"}`);
    console.log(`  Population column: ${cols.populationCol >= 0 ? headers[cols.populationCol] : "NOT FOUND"}`);
    console.log(`  Notes columns: ${cols.notesCols.map((i) => headers[i]).join(", ") || "NONE"}`);

    if (cols.entityCol === -1 && cols.fieldCol === -1) {
      console.warn(`  Could not find entity or field columns, skipping ${spec.path}`);
      continue;
    }

    const batches = buildBatches(dataRows, headers, cols, spec);
    console.log(`  Found ${batches.length} entity batches from ${dataRows.length} data rows\n`);

    if (DRY_RUN) {
      for (const batch of batches) {
        console.log(`  [dry-run] ${batch.entityName}: ${batch.rows.length} rows`);
      }
      continue;
    }

    for (const batch of batches) {
      const textBlock = `Entity: ${batch.entityName}\n\n${batch.rows.join("\n---\n")}`;
      const sourceRef = `${spec.milestone.toLowerCase()}-tracker/${batch.entityName}`;

      try {
        const claims = await extractClaims(
          textBlock,
          entityNames,
          "google_sheet",
          sourceRef,
          spec.milestone,
        );

        // Resolve entity/field names against DB
        for (const claim of claims) {
          if (claim.entityName) {
            const resolved = await resolveEntity(claim.entityName);
            if (resolved) claim.entityName = resolved;
          }
          if (claim.entityName && claim.fieldName) {
            const resolved = await resolveField(claim.entityName, claim.fieldName);
            if (resolved) claim.fieldName = resolved;
          }
        }

        allClaims.push(...claims);
        console.log(`  ${batch.entityName}: ${claims.length} claims extracted`);
      } catch (err: any) {
        console.error(`  ${batch.entityName}: ERROR - ${err.message}`);
      }

      // Rate limit: 1 second between LLM calls
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] Would extract claims from ${availableSpecs.length} file(s). No LLM calls made.`);
    return;
  }

  if (allClaims.length > 0) {
    saveClaims("sheets-claims.json", allClaims);
  } else {
    console.log("\nNo claims extracted.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
