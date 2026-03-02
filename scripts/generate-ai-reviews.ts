/**
 * Generate AI reviews for all latest mappings in specified entities.
 *
 * Usage:
 *   npx tsx scripts/generate-ai-reviews.ts foreclosure
 *   npx tsx scripts/generate-ai-reviews.ts loan foreclosure borrower
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, user } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateEntityAiReviews } from "../src/lib/generation/ai-review";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npx tsx scripts/generate-ai-reviews.ts <entity1> [entity2] ...");
  process.exit(1);
}

// Resolve workspace
const ws = db.select().from(entity).limit(1).get();
if (!ws) { console.error("No entities in DB"); process.exit(1); }
const WORKSPACE_ID = ws.workspaceId;

async function main() {
  console.log(`\nGenerating AI Reviews\n`);

  for (const name of args) {
    const ent = db.select().from(entity)
      .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, name), eq(entity.side, "target")))
      .get();

    if (!ent) {
      console.log(`  Entity "${name}" not found — skipping`);
      continue;
    }

    console.log(`[${name}]`);
    const start = Date.now();
    const { reviewed, errors } = await generateEntityAiReviews(WORKSPACE_ID, ent.id, { parallel: 3 });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Done: ${reviewed} reviewed, ${errors} errors, ${elapsed}s\n`);
  }
}

main().catch(console.error);
