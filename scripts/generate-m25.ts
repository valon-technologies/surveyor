/**
 * Generate mappings + AI reviews for M2.5 fields that don't have mappings.
 * Two-pass: (1) batch generation, (2) AI review.
 *
 * Usage: npx tsx scripts/generate-m25.ts
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { db } from "../src/lib/db";
import { entity, field, fieldMapping, user } from "../src/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { startGeneration, executeGeneration } from "../src/lib/generation/runner";
import { runSingleEntity } from "../src/lib/generation/batch-runner";

// Resolve workspace + user
const ws = db.select().from(entity).limit(1).get();
if (!ws) { console.error("No entities"); process.exit(1); }
const WORKSPACE_ID = ws.workspaceId;

const usr = db.select().from(user).limit(1).get();
if (!usr) { console.error("No users"); process.exit(1); }
const USER_ID = usr.id;

async function main() {
  // Find entities with unmapped M2.5 fields
  const rows = db.all(sql`
    SELECT DISTINCT e.id, e.name,
      (SELECT count(*) FROM field f2 WHERE f2.entity_id = e.id AND f2.milestone = 'M2.5'
       AND NOT EXISTS (SELECT 1 FROM field_mapping fm WHERE fm.target_field_id = f2.id AND fm.is_latest = 1)) as unmapped_count,
      (SELECT count(*) FROM field f3 WHERE f3.entity_id = e.id) as total_fields
    FROM entity e
    JOIN field f ON f.entity_id = e.id
    WHERE e.side = 'target' AND f.milestone = 'M2.5'
      AND NOT EXISTS (SELECT 1 FROM field_mapping fm WHERE fm.target_field_id = f.id AND fm.is_latest = 1)
    ORDER BY unmapped_count DESC
  `) as { id: string; name: string; unmapped_count: number; total_fields: number }[];

  console.log(`\n=== M2.5 Generation (Opus) ===`);
  console.log(`${rows.length} entities with unmapped M2.5 fields\n`);

  let totalGenerated = 0;
  let totalErrors = 0;

  for (const row of rows) {
    console.log(`[${row.name}] ${row.unmapped_count} unmapped M2.5 / ${row.total_fields} total fields`);

    try {
      const { prepared } = startGeneration({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        entityId: row.id,
        generationType: "batch",
        preferredProvider: "claude",
        outputFormat: "yaml",
      });

      await executeGeneration(prepared);

      // Check result
      const gen = db.select({ status: sql`status`, fieldMappings: sql`json_array_length(json_extract(output_parsed, '$.fieldMappings'))` })
        .from(sql`generation`)
        .where(sql`id = ${prepared.generationId}`)
        .get() as { status: string; fieldMappings: number } | undefined;

      if (gen?.status === "completed") {
        console.log(`  ✓ Generated (${gen.fieldMappings || 0} mappings parsed)`);
        totalGenerated++;
      } else {
        console.log(`  ✗ Failed: ${gen?.status || "unknown"}`);
        totalErrors++;
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err instanceof Error ? err.message : err}`);
      totalErrors++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Generated: ${totalGenerated}/${rows.length} entities`);
  if (totalErrors > 0) console.log(`Errors: ${totalErrors}`);

  // Pass 2: AI reviews
  console.log(`\n=== Pass 2: AI Reviews ===`);
  // Import dynamically to avoid circular deps
  const { generateAiReview } = await import("../src/lib/generation/ai-review");

  let reviewCount = 0;
  for (const row of rows) {
    // Get all latest mappings for this entity that don't have AI reviews yet
    const mappings = db.all(sql`
      SELECT fm.id FROM field_mapping fm
      JOIN field f ON fm.target_field_id = f.id
      WHERE f.entity_id = ${row.id} AND fm.is_latest = 1
        AND fm.ai_review IS NULL
        AND fm.status NOT IN ('excluded', 'accepted')
    `) as { id: string }[];

    if (mappings.length === 0) continue;

    console.log(`[${row.name}] ${mappings.length} mappings need review`);

    for (const m of mappings) {
      try {
        await generateAiReview(m.id, WORKSPACE_ID);
        reviewCount++;
      } catch (err) {
        // Non-critical — log and continue
        console.log(`  ✗ Review failed for ${m.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`\nAI reviews generated: ${reviewCount}`);
  console.log(`\nDone.`);
}

main().catch(console.error);
