/**
 * Import mapping QA hints from mapping-engine as context docs.
 * Usage: npx tsx --env-file=.env.local scripts/import-qa-hints.ts
 */
import { db } from "../src/lib/db";
import { context, entity } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

async function main() {
  const data = JSON.parse(
    readFileSync("/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/mapping-qa-index.json", "utf-8")
  );
  const hints = data.field_hints as Record<string, Record<string, { acdc_table: string; acdc_field: string }>>;

  // Get workspace ID
  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) {
    console.error("No entities");
    process.exit(1);
  }
  const WORKSPACE_ID = firstEntity.workspaceId;

  let imported = 0;
  let skipped = 0;

  for (const [entityName, fields] of Object.entries(hints)) {
    // Check if entity exists
    const [ent] = await db
      .select({ id: entity.id })
      .from(entity)
      .where(
        and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, entityName), eq(entity.side, "target"))
      );

    if (!ent) {
      skipped++;
      continue;
    }

    // Check if already exists
    const existing = await db
      .select({ id: context.id })
      .from(context)
      .where(
        and(eq(context.workspaceId, WORKSPACE_ID), eq(context.name, `Mapping QA Hints > ${entityName}`))
      );

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Build markdown content
    const lines: string[] = [
      `# Mapping QA Hints: ${entityName}`,
      "",
      "Field-level source hints from ServiceMac mapping Q&A sessions. These are confirmed ACDC source field mappings.",
      "",
      "| VDS Field | ACDC Table | ACDC Field |",
      "|-----------|-----------|------------|",
    ];

    for (const [fieldName, hint] of Object.entries(fields)) {
      const acdc_field = hint.acdc_field.replace(/\n/g, ", ").trim();
      lines.push(`| ${fieldName} | ${hint.acdc_table} | ${acdc_field} |`);
    }

    const content = lines.join("\n");
    const tokenCount = Math.ceil(content.length / 4);

    await db.insert(context).values({
      id: randomUUID(),
      workspaceId: WORKSPACE_ID,
      name: `Mapping QA Hints > ${entityName}`,
      category: "schema",
      subcategory: "domain_knowledge",
      entityId: ent.id,
      content,
      contentFormat: "markdown",
      tokenCount,
      tags: ["mapping-qa", "field-hints"],
      isActive: true,
    });

    imported++;
  }

  console.log(`Imported: ${imported}, Skipped: ${skipped} (no matching entity or already exists)`);
}

main().catch(console.error);
