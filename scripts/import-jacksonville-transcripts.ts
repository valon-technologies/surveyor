#!/usr/bin/env npx tsx
/**
 * Import Jacksonville onsite transcripts as generation context.
 * Stores as adhoc/transcript, separate from existing skills.
 *
 * Usage:
 *   npx tsx scripts/import-jacksonville-transcripts.ts [--dry-run]
 */

import { db } from "../src/lib/db";
import { context, entity } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

const dryRun = process.argv.includes("--dry-run");

const TRANSCRIPTS_DIR = "/Users/rob/code/mapping-engine/skills-sanitized/servicemac-m1/transcripts";

const FILES = [
  {
    path: `${TRANSCRIPTS_DIR}/DISTILLED-TRANSCRIPT-NOTES.md`,
    name: "Jacksonville Onsite > Distilled Notes (All Sessions)",
    description: "Distilled domain knowledge from all 4 mapping sessions (Oct 8-9, 2025)",
  },
  {
    path: `${TRANSCRIPTS_DIR}/day-1-morning-mapping.md`,
    name: "Jacksonville Onsite > Day 1 Morning",
    description: "Session 1: System architecture, ACDC overview, payments, escrow",
  },
  {
    path: `${TRANSCRIPTS_DIR}/day-1-afternoon-mapping.md`,
    name: "Jacksonville Onsite > Day 1 Afternoon",
    description: "Session 2: Delinquency, collections, loss mitigation",
  },
  {
    path: `${TRANSCRIPTS_DIR}/day-2-morning-mapping.md`,
    name: "Jacksonville Onsite > Day 2 Morning",
    description: "Session 3: Foreclosure, bankruptcy, REO, property preservation",
  },
  {
    path: `${TRANSCRIPTS_DIR}/day-2-afternoon-mapping.md`,
    name: "Jacksonville Onsite > Day 2 Afternoon",
    description: "Session 4: Investor reporting, ARM, insurance, tax",
  },
];

async function main() {
  console.log(`=== Import Jacksonville Onsite Transcripts${dryRun ? " (DRY RUN)" : ""} ===\n`);

  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities"); process.exit(1); }
  const workspaceId = firstEntity.workspaceId;

  let created = 0;
  let updated = 0;

  for (const file of FILES) {
    const content = readFileSync(file.path, "utf-8");
    const tokenCount = Math.ceil(content.length / 4);

    console.log(`  ${file.name}: ${tokenCount} tokens`);

    if (dryRun) continue;

    const [existing] = await db
      .select({ id: context.id })
      .from(context)
      .where(and(eq(context.workspaceId, workspaceId), eq(context.name, file.name)));

    if (existing) {
      await db.update(context)
        .set({ content, tokenCount, updatedAt: new Date().toISOString() })
        .where(eq(context.id, existing.id));
      updated++;
      continue;
    }

    await db.insert(context).values({
      id: randomUUID(),
      workspaceId,
      name: file.name,
      category: "adhoc",
      subcategory: "transcript",
      content,
      contentFormat: "markdown",
      tokenCount,
      tags: ["jacksonville", "onsite", "servicemac", "oct-2025"],
      isActive: true,
      importSource: "jacksonville-onsite-transcripts",
      metadata: {
        source: "mapping-engine/skills-sanitized/servicemac-m1/transcripts",
        description: file.description,
        session_dates: "2025-10-08, 2025-10-09",
      },
    });
    created++;
  }

  console.log(`\nDone: ${created} created, ${updated} updated`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
