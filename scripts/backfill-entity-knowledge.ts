/**
 * One-time script to backfill Entity Knowledge context docs for all entities
 * that have existing learning records or resolved questions.
 *
 * Usage: npx tsx scripts/backfill-entity-knowledge.ts
 */
import { db } from "../src/lib/db";
import { learning, question, entity } from "../src/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { rebuildEntityKnowledge } from "../src/lib/generation/entity-knowledge";

const workspaceId = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";

// Find all entities with learnings or resolved questions
const entitiesWithLearnings = db
  .selectDistinct({ entityId: learning.entityId })
  .from(learning)
  .where(and(eq(learning.workspaceId, workspaceId), sql`${learning.entityId} IS NOT NULL`))
  .all()
  .map((r) => r.entityId!);

const entitiesWithResolvedQs = db
  .selectDistinct({ entityId: question.entityId })
  .from(question)
  .where(
    and(
      eq(question.workspaceId, workspaceId),
      eq(question.status, "resolved"),
      sql`${question.entityId} IS NOT NULL`,
    ),
  )
  .all()
  .map((r) => r.entityId!);

const allEntityIds = [...new Set([...entitiesWithLearnings, ...entitiesWithResolvedQs])];

console.log(`Found ${allEntityIds.length} entities with learnings or resolved questions`);

let created = 0;
let updated = 0;

for (const entityId of allEntityIds) {
  const e = db.select({ name: entity.name }).from(entity).where(eq(entity.id, entityId)).get();
  const result = rebuildEntityKnowledge(workspaceId, entityId);

  if (result) {
    if (result.created) {
      created++;
      console.log(`  Created: ${e?.name || entityId}`);
    } else {
      updated++;
      console.log(`  Updated: ${e?.name || entityId}`);
    }
  } else {
    console.log(`  Skipped: ${e?.name || entityId} (no content)`);
  }
}

console.log(`\nDone: ${created} created, ${updated} updated`);
