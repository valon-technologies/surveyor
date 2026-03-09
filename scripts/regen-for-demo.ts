/**
 * Regenerate mappings for specific entities with improved prompts,
 * then run AI pre-review so the discuss page has pre-generated analysis.
 *
 * Usage: npx tsx --env-file=.env.local scripts/regen-for-demo.ts [entity1] [entity2] ...
 * Default entities: loss_mitigation_loan_modification, title_report, debtor_law_firm
 */
import { db } from "../src/lib/db";
import { entity, user } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createBatchRun, executeBatchRun } from "../src/lib/generation/batch-runner";
import { generateEntityAiReviews } from "../src/lib/generation/ai-review";

const DEFAULT_ENTITIES = [
  "loss_mitigation_loan_modification",
  "title_report",
  "debtor_law_firm",
];

async function main() {
  const entityNames = process.argv.length > 2
    ? process.argv.slice(2)
    : DEFAULT_ENTITIES;

  // Resolve workspace + user
  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities in DB"); process.exit(1); }
  const WORKSPACE_ID = firstEntity.workspaceId;

  const [firstUser] = await db.select().from(user).limit(1);
  if (!firstUser) { console.error("No users in DB"); process.exit(1); }
  const USER_ID = firstUser.id;

  // Resolve entity IDs
  const entityIds: string[] = [];
  for (const name of entityNames) {
    const [ent] = await db.select().from(entity)
      .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, name), eq(entity.side, "target")));
    if (!ent) {
      console.log(`Entity "${name}" not found — skipping`);
      continue;
    }
    entityIds.push(ent.id);
    console.log(`Found: ${name} (${ent.id})`);
  }

  if (entityIds.length === 0) {
    console.error("No valid entities found");
    process.exit(1);
  }

  // Phase 1: Regenerate mappings
  console.log(`\n=== Phase 1: Regenerating ${entityIds.length} entities ===\n`);
  const start = Date.now();

  const batchInput = {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    preferredProvider: "claude" as const,
    outputFormat: "yaml" as const,
    includeStatuses: ["unmapped", "unreviewed", "punted", "needs_discussion"] as any,
    milestone: "M2.5",
    entityIds,
  };

  const { batchRunId, entities: batches, totalFields } = await createBatchRun(batchInput);

  console.log(`Batch run: ${batchRunId}`);
  console.log(`Entities: ${batches.length}, Fields: ${totalFields}\n`);

  await executeBatchRun(batchRunId, batches, batchInput);

  const genElapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nGeneration done in ${genElapsed}s\n`);

  // Phase 2: AI pre-review
  console.log(`=== Phase 2: AI Pre-Review ===\n`);
  for (const name of entityNames) {
    const [ent] = await db.select().from(entity)
      .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, name), eq(entity.side, "target")));
    if (!ent) continue;

    console.log(`[${name}] Running AI reviews...`);
    const reviewStart = Date.now();
    const { reviewed, errors } = await generateEntityAiReviews(WORKSPACE_ID, ent.id, { parallel: 3 });
    const elapsed = ((Date.now() - reviewStart) / 1000).toFixed(1);
    console.log(`  ${reviewed} reviewed, ${errors} errors, ${elapsed}s\n`);
  }

  const totalElapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nAll done in ${totalElapsed}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
