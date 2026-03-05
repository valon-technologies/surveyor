/**
 * Backfill Entity Knowledge context docs for all entities that have
 * validated learning records or resolved questions.
 *
 * Usage: npx tsx scripts/backfill-entity-knowledge.ts
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { learning, question, entity } = await import("../src/lib/db/schema");
  const { eq, and, sql } = await import("drizzle-orm");
  const { rebuildEntityKnowledge } = await import("../src/lib/generation/entity-knowledge");

  // Get workspace
  const [ws] = await db.select().from(entity).limit(1);
  if (!ws) { console.error("No entities"); process.exit(1); }
  const workspaceId = ws.workspaceId;

  // Find entities with validated learnings
  const entitiesWithLearnings = (await db
    .selectDistinct({ entityId: learning.entityId })
    .from(learning)
    .where(and(
      eq(learning.workspaceId, workspaceId),
      sql`${learning.entityId} IS NOT NULL`,
      eq(learning.validationStatus, "validated"),
    ))
  ).map((r) => r.entityId!);

  // Find entities with resolved questions
  const entitiesWithResolvedQs = (await db
    .selectDistinct({ entityId: question.entityId })
    .from(question)
    .where(and(
      eq(question.workspaceId, workspaceId),
      eq(question.status, "resolved"),
      sql`${question.entityId} IS NOT NULL`,
    ))
  ).map((r) => r.entityId!);

  const allEntityIds = [...new Set([...entitiesWithLearnings, ...entitiesWithResolvedQs])];
  console.log(`Found ${allEntityIds.length} entities with validated learnings or resolved questions`);

  if (allEntityIds.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entityId of allEntityIds) {
    const [e] = await db.select({ name: entity.name }).from(entity).where(eq(entity.id, entityId));
    try {
      const result = await rebuildEntityKnowledge(workspaceId, entityId);
      if (result) {
        if (result.created) {
          created++;
          console.log(`  Created: ${e?.name || entityId}`);
        } else {
          updated++;
          console.log(`  Updated: ${e?.name || entityId}`);
        }
      } else {
        skipped++;
        console.log(`  Skipped: ${e?.name || entityId} (no content)`);
      }
    } catch (err) {
      console.log(`  Error: ${e?.name || entityId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${skipped} skipped`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
