/**
 * Delete Entity Knowledge context docs that contain toxic SUBSET corrections.
 * These cause the model to collapse (e.g. borrower went from 41.7% → 0%)
 * because it can't satisfy "REQUIRED: Must include all of X, Y" within
 * single-source-per-mapping format and gives up entirely.
 *
 * Also deletes the underlying learning records that generated the toxic EK,
 * so they won't be re-included on next rebuildEntityKnowledge() call.
 *
 * Usage: npx tsx scripts/delete-toxic-ek.ts [--dry-run]
 */
import { db } from "../src/lib/db";
import { context, learning, entity } from "../src/lib/db/schema";
import { eq, and, like } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");
// Auto-detect workspace ID from the first entity in the DB
const firstEntity = db.select({ ws: entity.workspaceId }).from(entity).limit(1).get();
if (!firstEntity) {
  console.error("No entities in DB");
  process.exit(1);
}
const workspaceId = firstEntity.ws;

// SUBSET-affected entities where EK corrections caused regressions
const TOXIC_ENTITIES = [
  "borrower",
  "address",
  "borrower_phone_number",
  "borrower_notification_preference",
  "notification_email_detail",
];

console.log(`${dryRun ? "[DRY RUN] " : ""}Cleaning toxic SUBSET Entity Knowledge...\n`);

let ekDeleted = 0;
let learningsDeleted = 0;

for (const entityName of TOXIC_ENTITIES) {
  // Find the entity
  const e = db
    .select({ id: entity.id, name: entity.name })
    .from(entity)
    .where(and(eq(entity.workspaceId, workspaceId), eq(entity.name, entityName)))
    .get();

  if (!e) {
    // Try displayName
    const e2 = db
      .select({ id: entity.id, name: entity.name })
      .from(entity)
      .where(and(eq(entity.workspaceId, workspaceId), like(entity.name, `%${entityName}%`)))
      .get();
    if (!e2) {
      console.log(`  Skip: "${entityName}" — entity not found`);
      continue;
    }
    Object.assign(e ?? {}, e2);
    if (!e) continue;
  }

  // Find Entity Knowledge context docs for this entity
  const ekDocs = db
    .select({ id: context.id, name: context.name })
    .from(context)
    .where(
      and(
        eq(context.workspaceId, workspaceId),
        eq(context.subcategory, "entity_knowledge"),
        eq(context.entityId, e.id),
      ),
    )
    .all();

  // Find learning records for this entity
  const entityLearnings = db
    .select({ id: learning.id, content: learning.content })
    .from(learning)
    .where(and(eq(learning.workspaceId, workspaceId), eq(learning.entityId, e.id)))
    .all();

  // Filter to learnings that contain SUBSET-style corrections
  const toxicLearnings = entityLearnings.filter(
    (l) =>
      l.content?.includes("REQUIRED") ||
      l.content?.includes("Must include") ||
      l.content?.includes("Expected sources:") ||
      l.content?.includes("SUBSET"),
  );

  if (ekDocs.length === 0 && toxicLearnings.length === 0) {
    console.log(`  Skip: "${entityName}" — no EK docs or toxic learnings`);
    continue;
  }

  console.log(`  ${entityName}: ${ekDocs.length} EK doc(s), ${toxicLearnings.length} toxic learning(s)`);

  if (!dryRun) {
    for (const doc of ekDocs) {
      db.delete(context).where(eq(context.id, doc.id)).run();
      console.log(`    Deleted EK: ${doc.name}`);
      ekDeleted++;
    }
    for (const l of toxicLearnings) {
      db.delete(learning).where(eq(learning.id, l.id)).run();
      console.log(`    Deleted learning: ${l.content?.slice(0, 80)}...`);
      learningsDeleted++;
    }
  } else {
    for (const doc of ekDocs) {
      console.log(`    Would delete EK: ${doc.name}`);
      ekDeleted++;
    }
    for (const l of toxicLearnings) {
      console.log(`    Would delete learning: ${l.content?.slice(0, 80)}...`);
      learningsDeleted++;
    }
  }
}

console.log(`\n${dryRun ? "[DRY RUN] " : ""}Done: ${ekDeleted} EK docs, ${learningsDeleted} toxic learnings ${dryRun ? "would be " : ""}deleted`);
