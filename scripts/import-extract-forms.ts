/**
 * Import extract request forms and mapping Q&A XLSX files as context docs.
 * Usage: npx tsx --env-file=.env.local scripts/import-extract-forms.ts
 */
import { db } from "../src/lib/db";
import { context, entity } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";

const FILES = [
  {
    path: "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/[External] Ocean Extract Request 11.17.25.xlsx",
    name: "ServiceMac > Extract Request 11.17.25",
    subcategory: "domain_knowledge",
  },
  {
    path: "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/[External] Ocean Extract Requests 10.17.25.xlsx",
    name: "ServiceMac > Extract Requests 10.17.25",
    subcategory: "domain_knowledge",
  },
  {
    path: "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m2/M2 Mapping Extract Request Form.xlsx",
    name: "ServiceMac > M2 Extract Request Form",
    subcategory: "domain_knowledge",
  },
  {
    path: "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/12.11.25 M1 Questions - for ServiceMac Sharepoint.xlsx",
    name: "ServiceMac > M1 Questions (SharePoint)",
    subcategory: "domain_knowledge",
  },
  {
    path: "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/[EXTERNAL] ACDC __ VDS Mapping Questions.xlsx",
    name: "ServiceMac > ACDC-VDS Mapping Questions",
    subcategory: "domain_knowledge",
  },
];

async function main() {
  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) {
    console.error("No entities");
    process.exit(1);
  }
  const WORKSPACE_ID = firstEntity.workspaceId;

  let imported = 0;
  let skipped = 0;

  for (const file of FILES) {
    // Check if already exists
    const [existing] = await db
      .select({ id: context.id })
      .from(context)
      .where(and(eq(context.workspaceId, WORKSPACE_ID), eq(context.name, file.name)));

    if (existing) {
      console.log(`Skipped (exists): ${file.name}`);
      skipped++;
      continue;
    }

    try {
      const buf = readFileSync(file.path);
      const wb = XLSX.read(buf);

      const parts: string[] = [`# ${file.name}\n`];

      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

        if (rows.length === 0) continue;

        parts.push(`## Sheet: ${sheetName} (${rows.length} rows)\n`);

        // Build markdown table
        const headers = Object.keys(rows[0]);
        parts.push("| " + headers.join(" | ") + " |");
        parts.push("| " + headers.map(() => "---").join(" | ") + " |");

        for (const row of rows.slice(0, 500)) { // cap at 500 rows
          const cells = headers.map((h) => String(row[h] ?? "").replace(/\n/g, " ").replace(/\|/g, "\\|"));
          parts.push("| " + cells.join(" | ") + " |");
        }

        if (rows.length > 500) {
          parts.push(`\n*...truncated (${rows.length - 500} more rows)*`);
        }
        parts.push("");
      }

      const content = parts.join("\n");
      const tokenCount = Math.ceil(content.length / 4);

      await db.insert(context).values({
        id: randomUUID(),
        workspaceId: WORKSPACE_ID,
        name: file.name,
        category: "foundational",
        subcategory: file.subcategory,
        content,
        contentFormat: "markdown",
        tokenCount,
        tags: ["extract-request", "xlsx-import"],
        isActive: true,
      });

      console.log(`Imported: ${file.name} (${tokenCount} tokens, ${wb.SheetNames.length} sheets)`);
      imported++;
    } catch (err) {
      console.error(`Failed: ${file.name} — ${err}`);
    }
  }

  console.log(`\nDone: ${imported} imported, ${skipped} skipped`);
}

main().catch(console.error);
