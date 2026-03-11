#!/usr/bin/env npx tsx
/**
 * Parse extract request forms into per-entity context docs with resolved Q&A.
 *
 * Reads XLSX extract request forms, groups rows by VDS entity, and creates
 * per-entity context documents in the adhoc/extract category. Separate from
 * existing skills/foundational context.
 *
 * Usage:
 *   npx tsx scripts/parse-extract-forms.ts [--dry-run]
 */

import { db } from "../src/lib/db";
import { context, entity } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";

const dryRun = process.argv.includes("--dry-run");

interface QARow {
  entityName: string;
  fieldName: string;
  question: string;
  answer: string;
  source: string; // which file/sheet this came from
  date?: string;
  extra: Record<string, string>; // other columns worth keeping
}

/**
 * Extract Q&A rows from a sheet with entity/field columns.
 * Handles various column naming conventions across the forms.
 */
function extractRows(
  rows: Record<string, unknown>[],
  sheetName: string,
  fileName: string,
): QARow[] {
  const results: QARow[] = [];
  if (rows.length === 0) return results;

  const headers = Object.keys(rows[0]);

  // Find entity column
  const entityCol = headers.find((h) =>
    /vds.*entity/i.test(h) || /^entity$/i.test(h) || /entity\s*name/i.test(h)
  );
  // Find field column
  const fieldCol = headers.find((h) =>
    /vds.*field/i.test(h) || /field\s*name/i.test(h)
  );

  if (!entityCol && !fieldCol) return results;

  // Find question/comment columns
  const questionCols = headers.filter((h) =>
    /question/i.test(h) || /comment/i.test(h) || /open/i.test(h) ||
    /ask/i.test(h) || /blocked/i.test(h) || /justification/i.test(h) ||
    /reasoning/i.test(h) || /explanation/i.test(h)
  );

  // Find answer/response columns
  const answerCols = headers.filter((h) =>
    /response/i.test(h) || /answer/i.test(h) || /valon/i.test(h) ||
    /resolution/i.test(h) || /resolved/i.test(h)
  );

  // Find definition column
  const defCol = headers.find((h) => /definition/i.test(h));
  const dateCol = headers.find((h) => /date/i.test(h));

  for (const row of rows) {
    const eName = String(row[entityCol || ""] ?? "").trim();
    const fName = String(row[fieldCol || ""] ?? "").trim();
    if (!eName && !fName) continue;

    const questionParts: string[] = [];
    for (const qc of questionCols) {
      const val = String(row[qc] ?? "").trim();
      if (val) questionParts.push(val);
    }

    const answerParts: string[] = [];
    for (const ac of answerCols) {
      const val = String(row[ac] ?? "").trim();
      if (val) answerParts.push(val);
    }

    const extra: Record<string, string> = {};
    if (defCol) {
      const def = String(row[defCol] ?? "").trim();
      if (def) extra.definition = def;
    }

    // Skip rows with no meaningful content
    if (questionParts.length === 0 && answerParts.length === 0 && !extra.definition) continue;

    results.push({
      entityName: eName || "unknown",
      fieldName: fName || "",
      question: questionParts.join(" | "),
      answer: answerParts.join(" | "),
      source: `${fileName} > ${sheetName}`,
      date: dateCol ? String(row[dateCol] ?? "").trim() : undefined,
      extra,
    });
  }

  return results;
}

/**
 * Render grouped Q&A rows as a markdown document for one entity.
 */
function renderEntityDoc(entityName: string, rows: QARow[]): string {
  const parts: string[] = [];
  parts.push(`# Extract Request Q&A: ${entityName}\n`);
  parts.push(`*${rows.length} items from extract request forms*\n`);

  // Group by field
  const byField = new Map<string, QARow[]>();
  for (const r of rows) {
    const key = r.fieldName || "(entity-level)";
    if (!byField.has(key)) byField.set(key, []);
    byField.get(key)!.push(r);
  }

  for (const [fieldName, fieldRows] of byField) {
    parts.push(`## ${fieldName}\n`);

    for (const r of fieldRows) {
      if (r.extra.definition) {
        parts.push(`**Definition:** ${r.extra.definition}\n`);
      }
      if (r.question) {
        parts.push(`**Q:** ${r.question}`);
      }
      if (r.answer) {
        parts.push(`**A:** ${r.answer}`);
      }
      parts.push(`*Source: ${r.source}${r.date ? ` (${r.date})` : ""}*\n`);
    }
  }

  return parts.join("\n");
}

const FILES = [
  "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/[External] Ocean Extract Request 11.17.25.xlsx",
  "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/[External] Ocean Extract Requests 10.17.25.xlsx",
  "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m2/M2 Mapping Extract Request Form.xlsx",
  "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/[EXTERNAL] ACDC __ VDS Mapping Questions.xlsx",
  "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/12.11.25 M1 Questions - for ServiceMac Sharepoint.xlsx",
];

async function main() {
  console.log(`=== Parse Extract Forms into Per-Entity Context${dryRun ? " (DRY RUN)" : ""} ===\n`);

  // Get workspace
  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities"); process.exit(1); }
  const workspaceId = firstEntity.workspaceId;

  // Load all target entities for name matching
  const allEntities = await db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.side, "target")));

  const entityByName = new Map<string, string>(); // lowercase name → id
  for (const e of allEntities) {
    entityByName.set(e.name.toLowerCase(), e.id);
    if (e.displayName) entityByName.set(e.displayName.toLowerCase(), e.id);
    // Also try without underscores
    entityByName.set(e.name.toLowerCase().replace(/_/g, ""), e.id);
  }

  // Parse all files
  const allRows: QARow[] = [];

  for (const filePath of FILES) {
    const fileName = filePath.split("/").pop() || filePath;
    try {
      const buf = readFileSync(filePath);
      const wb = XLSX.read(buf);

      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
        const extracted = extractRows(rows, sheetName, fileName);
        allRows.push(...extracted);
      }
      console.log(`Parsed: ${fileName}`);
    } catch (err) {
      console.error(`Failed to read: ${fileName} — ${err}`);
    }
  }

  console.log(`\nTotal Q&A rows extracted: ${allRows.length}`);

  // Group by entity
  const byEntity = new Map<string, QARow[]>();
  for (const r of allRows) {
    const key = r.entityName.toLowerCase().replace(/[_\s]+/g, "_");
    if (!byEntity.has(key)) byEntity.set(key, []);
    byEntity.get(key)!.push(r);
  }

  console.log(`Unique entities: ${byEntity.size}\n`);

  // Create per-entity context docs
  let created = 0;
  let skipped = 0;

  for (const [entityKey, rows] of byEntity) {
    const entityName = rows[0].entityName;
    const docName = `Extract Q&A > ${entityName}`;

    // Resolve entity ID
    const entityId = entityByName.get(entityKey) ||
      entityByName.get(entityKey.replace(/_/g, "")) ||
      null;

    const content = renderEntityDoc(entityName, rows);
    const tokenCount = Math.ceil(content.length / 4);

    console.log(`  ${docName}: ${rows.length} items, ${tokenCount} tokens${entityId ? "" : " (no entity match)"}`);

    if (dryRun) continue;

    // Check if already exists
    const [existing] = await db
      .select({ id: context.id })
      .from(context)
      .where(and(eq(context.workspaceId, workspaceId), eq(context.name, docName)));

    if (existing) {
      // Update existing
      await db.update(context)
        .set({ content, tokenCount, updatedAt: new Date().toISOString() })
        .where(eq(context.id, existing.id));
      skipped++;
      continue;
    }

    await db.insert(context).values({
      id: randomUUID(),
      workspaceId,
      name: docName,
      category: "adhoc",
      subcategory: "extract",
      entityId,
      content,
      contentFormat: "markdown",
      tokenCount,
      tags: ["extract-request", "qa", "per-entity"],
      isActive: true,
      importSource: "parse-extract-forms",
      metadata: {
        rowCount: rows.length,
        sources: [...new Set(rows.map((r) => r.source))],
      },
    });
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} updated`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
