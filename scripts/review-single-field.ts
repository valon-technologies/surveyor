/**
 * Re-generate AI review for a single mapping.
 * Usage: npx tsx scripts/review-single-field.ts <mapping-id>
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity } from "../src/lib/db/schema";
import { generateAiReview } from "../src/lib/generation/ai-review";

const mappingId = process.argv[2];
if (!mappingId) { console.error("Usage: npx tsx scripts/review-single-field.ts <mapping-id>"); process.exit(1); }

const ws = db.select().from(entity).limit(1).get();
if (!ws) { console.error("No entities"); process.exit(1); }

async function main() {
  console.log(`Reviewing mapping ${mappingId}...`);
  const result = await generateAiReview(ws!.workspaceId, mappingId);
  if (result) {
    console.log("\nReview text:", result.reviewText.slice(0, 500));
    console.log("\nProposed update:", JSON.stringify(result.proposedUpdate, null, 2));
  } else {
    console.log("No result");
  }
}

main().catch(console.error);
