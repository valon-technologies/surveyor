/**
 * Google Sheet threaded-comment extraction for the Context Harvester.
 *
 * Downloads the Rosetta workbook XLSX via Gestalt Drive API, parses the ZIP
 * to extract threaded comments from xl/threadedComments/*.xml, maps cell
 * references back to entity/field rows using sheet data, and sends comment
 * threads through the LLM claim extractor.
 *
 * Usage:
 *   npx tsx scripts/harvest/extract-sheet-comments.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

// Load .env.local before any other imports that read env
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import * as AdmZip from "adm-zip";
import { gestaltGet } from "./lib/gestalt-client";
import { extractClaims } from "./lib/claim-extractor";
import { resolveEntity, resolveField, getEntityNames } from "./lib/entity-resolver";
import { saveClaims } from "./lib/store";
import type { HarvestedClaim } from "./lib/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const SPREADSHEET_ID = "1c6FlGBbNEdEOGsWvnwYiAmRtm6Mr2lLnWZ7oCmynrXY";
const DATA_DIR = "scripts/harvest/data";

/** Sheets we care about (discovered from workbook structure). */
const TARGET_SHEETS: { sheetIndex: number; name: string; milestone: "M1" | "M2" }[] = [
  { sheetIndex: 15, name: "VDS M1 Tracker", milestone: "M1" },
  { sheetIndex: 7, name: "VDS M2 Tracker", milestone: "M2" },
];

// ---------------------------------------------------------------------------
// XLSX download
// ---------------------------------------------------------------------------

async function downloadXlsx(): Promise<Buffer> {
  const cachePath = `${DATA_DIR}/rosetta-workbook.xlsx`;

  // Use cached file if it exists (15MB download, avoid repeating)
  if (existsSync(cachePath)) {
    console.log(`Using cached XLSX: ${cachePath}`);
    return readFileSync(cachePath);
  }

  console.log("Downloading XLSX via Gestalt Drive API...");
  const result = await gestaltGet<{ content_base64: string }>(
    "google_drive",
    "export_file",
    {
      file_id: SPREADSHEET_ID,
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );

  const buf = Buffer.from(result.content_base64, "base64");
  console.log(`Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // Cache for re-runs
  writeFileSync(cachePath, buf);
  console.log(`Cached to ${cachePath}`);

  return buf;
}

// ---------------------------------------------------------------------------
// XML helpers (simple regex parsing — these are well-structured XMLs)
// ---------------------------------------------------------------------------

function attrVal(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}="([^"]*)"`, "i");
  const m = tag.match(re);
  return m ? m[1] : null;
}

function innerText(xml: string, tagName: string): string {
  const re = new RegExp(`<${tagName}[^>]*>(.*?)</${tagName}>`, "gs");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results.join("\n");
}

// ---------------------------------------------------------------------------
// Cell reference parsing (e.g. "BA1621" -> { col: "BA", row: 1621 })
// ---------------------------------------------------------------------------

interface CellRef {
  col: string;
  row: number;
}

function parseCellRef(ref: string): CellRef | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { col: m[1], row: parseInt(m[2], 10) };
}

// ---------------------------------------------------------------------------
// Threaded comment parsing
// ---------------------------------------------------------------------------

interface ThreadedComment {
  ref: string; // cell reference like "BA1621"
  id: string;
  parentId: string | null;
  personId: string;
  text: string;
}

interface CommentThread {
  cellRef: string;
  row: number;
  col: string;
  comments: ThreadedComment[];
}

function parseThreadedComments(xml: string): ThreadedComment[] {
  const comments: ThreadedComment[] = [];

  // Match each <threadedComment ...>...</threadedComment>
  const tagRe = /<threadedComment\s([^>]+)>([\s\S]*?)<\/threadedComment>/g;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];

    const ref = attrVal(attrs, "ref");
    const id = attrVal(attrs, "id");
    const parentId = attrVal(attrs, "parentId");
    const personId = attrVal(attrs, "personId");

    if (!ref || !id) continue;

    // Extract <text> content
    const textMatch = body.match(/<text[^>]*>([\s\S]*?)<\/text>/);
    const text = textMatch ? textMatch[1].trim() : "";

    comments.push({
      ref,
      id,
      parentId: parentId || null,
      personId: personId || "",
      text,
    });
  }

  return comments;
}

function groupIntoThreads(comments: ThreadedComment[]): CommentThread[] {
  // Group by cell reference
  const byRef = new Map<string, ThreadedComment[]>();
  for (const c of comments) {
    if (!byRef.has(c.ref)) byRef.set(c.ref, []);
    byRef.get(c.ref)!.push(c);
  }

  const threads: CommentThread[] = [];

  for (const [cellRef, cellComments] of Array.from(byRef.entries())) {
    const parsed = parseCellRef(cellRef);
    if (!parsed) continue;

    // Order: root comments first (no parentId), then replies
    // Build a simple ordering: roots first, then children by parentId chain
    const roots = cellComments.filter((c) => !c.parentId);
    const replies = cellComments.filter((c) => c.parentId);

    // Simple ordering: roots, then replies (they tend to be in order already)
    const ordered = [...roots, ...replies];

    if (ordered.length === 0) continue;

    threads.push({
      cellRef,
      row: parsed.row,
      col: parsed.col,
      comments: ordered,
    });
  }

  return threads;
}

// ---------------------------------------------------------------------------
// Sheet data parsing — extract entity/field from row
// ---------------------------------------------------------------------------

interface SheetRowMap {
  /** Maps row number -> { entity, field } */
  rows: Map<number, { entity: string; field: string }>;
}

/**
 * Parse sheet XML to build row -> entity/field map.
 * Looks for columns containing "VDS Table" (entity) and "VDS Field" (field).
 */
function parseSheetRowMap(sheetXml: string, sharedStrings: string[]): SheetRowMap {
  const rows = new Map<number, { entity: string; field: string }>();

  // Parse all cells: <c r="A1" t="s"><v>42</v></c>
  // We need to find entity and field columns from header row first
  const cellRe = /<c\s+r="([A-Z]+)(\d+)"([^>]*)>(?:<f[^>]*>[^<]*<\/f>)?<v>([^<]*)<\/v>/g;

  // First pass: collect all cell values
  const cellData = new Map<string, string>(); // "A1" -> value
  let m: RegExpExecArray | null;

  while ((m = cellRe.exec(sheetXml)) !== null) {
    const col = m[1];
    const row = m[2];
    const attrs = m[3];
    let value = m[4];

    // If type="s", value is an index into shared strings
    if (attrs.includes('t="s"') && sharedStrings.length > 0) {
      const idx = parseInt(value, 10);
      if (idx >= 0 && idx < sharedStrings.length) {
        value = sharedStrings[idx];
      }
    }

    cellData.set(`${col}${row}`, value);
  }

  // Find header row (usually row 1 or 2) — look for "VDS Table" / "VDS Field"
  let entityCol: string | null = null;
  let fieldCol: string | null = null;

  // Check first 5 rows for headers
  for (let r = 1; r <= 5; r++) {
    for (const [key, val] of Array.from(cellData.entries())) {
      const parsed = parseCellRef(key);
      if (!parsed || parsed.row !== r) continue;

      const lower = val.toLowerCase();
      if (
        (lower.includes("vds table") || (lower.includes("table") && !lower.includes("population"))) &&
        !entityCol
      ) {
        entityCol = parsed.col;
      }
      if ((lower.includes("vds field") || lower.includes("field name")) && !fieldCol) {
        fieldCol = parsed.col;
      }
    }
    if (entityCol && fieldCol) break;
  }

  if (!entityCol || !fieldCol) {
    return { rows };
  }

  // Build row map: for each row, entity carries forward (merged cells)
  let lastEntity = "";
  const allRows = new Set<number>();
  for (const key of Array.from(cellData.keys())) {
    const parsed = parseCellRef(key);
    if (parsed) allRows.add(parsed.row);
  }

  const sortedRows = Array.from(allRows).sort((a, b) => a - b);

  for (const row of sortedRows) {
    const entityVal = (cellData.get(`${entityCol}${row}`) ?? "").trim();
    const fieldVal = (cellData.get(`${fieldCol}${row}`) ?? "").trim();

    if (entityVal) lastEntity = entityVal;
    if (lastEntity && fieldVal) {
      rows.set(row, { entity: lastEntity, field: fieldVal });
    } else if (lastEntity) {
      rows.set(row, { entity: lastEntity, field: "" });
    }
  }

  return { rows };
}

/**
 * Parse shared strings from xl/sharedStrings.xml
 */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  // Each <si> element contains one or more <t> elements
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;

  while ((m = siRe.exec(xml)) !== null) {
    const siContent = m[1];
    // Collect all <t> values within this <si>
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    const parts: string[] = [];
    while ((tm = tRe.exec(siContent)) !== null) {
      parts.push(tm[1]);
    }
    strings.push(parts.join(""));
  }

  return strings;
}

// ---------------------------------------------------------------------------
// Workbook structure parsing
// ---------------------------------------------------------------------------

interface SheetInfo {
  name: string;
  sheetId: string;
  rId: string;
}

function parseWorkbook(workbookXml: string): SheetInfo[] {
  const sheets: SheetInfo[] = [];
  const re = /<sheet\s+name="([^"]+)"\s+sheetId="(\d+)"\s+(?:state="[^"]*"\s+)?r:id="([^"]+)"/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(workbookXml)) !== null) {
    sheets.push({ name: m[1], sheetId: m[2], rId: m[3] });
  }

  return sheets;
}

interface RelsEntry {
  id: string;
  target: string;
}

function parseRels(relsXml: string): RelsEntry[] {
  const entries: RelsEntry[] = [];
  const re = /<Relationship\s+Id="([^"]+)"\s+[^>]*Target="([^"]+)"/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(relsXml)) !== null) {
    entries.push({ id: m[1], target: m[2] });
  }

  return entries;
}

/**
 * Find which threadedComment file is linked to a given sheet file.
 */
function findThreadedCommentFile(sheetRelsXml: string): string | null {
  // Look for relationships pointing to ../threadedComments/...
  const re = /Target="([^"]*threadedComment[^"]*)"/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(sheetRelsXml)) !== null) {
    // Target is relative, e.g. "../threadedComments/threadedComment5.xml"
    const target = m[1];
    // Normalize to xl/threadedComments/...
    return target.replace(/^\.\.\//, "xl/");
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Sheet Comment Extraction ===\n");

  // 1. Download XLSX
  const xlsxBuf = await downloadXlsx();
  const zip = new AdmZip(xlsxBuf);

  // 2. Parse shared strings
  const sharedStringsEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(sharedStringsEntry.getData().toString("utf-8"))
    : [];
  console.log(`Shared strings: ${sharedStrings.length}`);

  // 3. Parse workbook to map sheet names -> sheet files
  const workbookEntry = zip.getEntry("xl/workbook.xml");
  if (!workbookEntry) throw new Error("No xl/workbook.xml found in XLSX");
  const workbookSheets = parseWorkbook(workbookEntry.getData().toString("utf-8"));
  console.log(`Workbook sheets: ${workbookSheets.length}`);

  // Parse workbook rels to map rIds -> filenames
  const workbookRelsEntry = zip.getEntry("xl/_rels/workbook.xml.rels");
  if (!workbookRelsEntry) throw new Error("No xl/_rels/workbook.xml.rels");
  const workbookRels = parseRels(workbookRelsEntry.getData().toString("utf-8"));

  // 4. For each target sheet, find its comment file and parse
  const entityNames = await getEntityNames();
  console.log(`Loaded ${entityNames.length} target entity names\n`);

  const allClaims: HarvestedClaim[] = [];
  let totalThreads = 0;
  let totalComments = 0;

  for (const target of TARGET_SHEETS) {
    console.log(`--- ${target.name} (${target.milestone}) ---`);

    // Find the sheet in workbook
    const sheetInfo = workbookSheets.find((s) => s.name === target.name);
    if (!sheetInfo) {
      console.warn(`  Sheet "${target.name}" not found in workbook, skipping`);
      continue;
    }

    // Resolve the sheet file via rels
    const rel = workbookRels.find((r) => r.id === sheetInfo.rId);
    if (!rel) {
      console.warn(`  No rel for ${sheetInfo.rId}, skipping`);
      continue;
    }

    const sheetFile = `xl/${rel.target}`;
    console.log(`  Sheet file: ${sheetFile}`);

    // Find threaded comment file via sheet rels
    const sheetRelsFile = sheetFile.replace(
      /worksheets\/(sheet\d+\.xml)/,
      "worksheets/_rels/$1.rels",
    );
    const sheetRelsEntry = zip.getEntry(sheetRelsFile);
    if (!sheetRelsEntry) {
      console.warn(`  No rels file ${sheetRelsFile}, skipping`);
      continue;
    }

    const commentFile = findThreadedCommentFile(sheetRelsEntry.getData().toString("utf-8"));
    if (!commentFile) {
      console.warn(`  No threaded comment file linked, skipping`);
      continue;
    }
    console.log(`  Comment file: ${commentFile}`);

    // Parse threaded comments
    const commentEntry = zip.getEntry(commentFile);
    if (!commentEntry) {
      console.warn(`  Comment file ${commentFile} not found in ZIP, skipping`);
      continue;
    }

    const commentXml = commentEntry.getData().toString("utf-8");
    const comments = parseThreadedComments(commentXml);
    const threads = groupIntoThreads(comments);

    console.log(`  Comments: ${comments.length}, Threads: ${threads.length}`);
    totalComments += comments.length;
    totalThreads += threads.length;

    // Parse sheet data for row -> entity/field mapping
    const sheetEntry = zip.getEntry(sheetFile);
    if (!sheetEntry) {
      console.warn(`  Sheet file ${sheetFile} not found, skipping`);
      continue;
    }

    const sheetXml = sheetEntry.getData().toString("utf-8");
    const rowMap = parseSheetRowMap(sheetXml, sharedStrings);
    console.log(`  Row map: ${rowMap.rows.size} rows with entity/field data`);

    // Filter threads: only those with substantive text (>20 chars total)
    const substantiveThreads = threads.filter((t) => {
      const totalText = t.comments.map((c) => c.text).join(" ");
      return totalText.length > 20;
    });
    console.log(`  Substantive threads (>20 chars): ${substantiveThreads.length}\n`);

    if (DRY_RUN) {
      // Print sample threads
      const sample = substantiveThreads.slice(0, 5);
      for (const thread of sample) {
        const rowInfo = rowMap.rows.get(thread.row);
        const entityField = rowInfo
          ? `${rowInfo.entity} / ${rowInfo.field || "(no field)"}`
          : `row ${thread.row}`;
        console.log(`  [dry-run] ${thread.cellRef} (${entityField}): ${thread.comments.length} comment(s)`);
        for (const c of thread.comments) {
          console.log(`    ${c.parentId ? "  reply:" : "root:"} ${c.text.slice(0, 80)}...`);
        }
      }
      if (substantiveThreads.length > 5) {
        console.log(`  ... and ${substantiveThreads.length - 5} more threads`);
      }
      continue;
    }

    // Group threads by entity for batching (send related threads together)
    const threadsByEntity = new Map<string, { threads: CommentThread[]; field: string }[]>();

    for (const thread of substantiveThreads) {
      const rowInfo = rowMap.rows.get(thread.row);
      const entity = rowInfo?.entity || "UNKNOWN";

      if (!threadsByEntity.has(entity)) threadsByEntity.set(entity, []);
      threadsByEntity.get(entity)!.push({
        threads: [thread],
        field: rowInfo?.field || "",
      });
    }

    // Process each entity batch
    for (const [entity, items] of Array.from(threadsByEntity.entries())) {
      // Build a text block for all threads in this entity
      const textParts: string[] = [];

      for (const item of items) {
        for (const thread of item.threads) {
          const rowInfo = rowMap.rows.get(thread.row);
          const header = rowInfo
            ? `Cell ${thread.cellRef} — Entity: ${rowInfo.entity}, Field: ${rowInfo.field || "(unknown)"}`
            : `Cell ${thread.cellRef} — Row ${thread.row}`;

          const threadText = thread.comments
            .map((c) => (c.parentId ? `  Reply: ${c.text}` : c.text))
            .join("\n");

          textParts.push(`${header}\n${threadText}`);
        }
      }

      // Batch into chunks of ~10 threads to keep LLM context reasonable
      const BATCH_SIZE = 10;
      for (let i = 0; i < textParts.length; i += BATCH_SIZE) {
        const batch = textParts.slice(i, i + BATCH_SIZE);
        const textBlock = `Sheet: ${target.name}\nEntity: ${entity}\n\n${batch.join("\n---\n")}`;
        const sourceRef = `sheet-comment:${target.name.replace(/\s+/g, "-")}:${entity}`;

        try {
          const claims = await extractClaims(
            textBlock,
            entityNames,
            "google_sheet",
            sourceRef,
            target.milestone,
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
          console.log(`  ${entity} [batch ${Math.floor(i / BATCH_SIZE) + 1}]: ${claims.length} claims`);
        } catch (err: any) {
          console.error(`  ${entity}: ERROR - ${err.message}`);
        }

        // Rate limit: 1 second between LLM calls
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Total comments: ${totalComments}`);
  console.log(`Total threads: ${totalThreads}`);

  if (DRY_RUN) {
    console.log(`\n[dry-run] No LLM calls made. Re-run without --dry-run to extract claims.`);
    return;
  }

  if (allClaims.length > 0) {
    saveClaims("sheet-comments-claims.json", allClaims);
  } else {
    console.log("\nNo claims extracted.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
