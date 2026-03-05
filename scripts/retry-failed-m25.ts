/**
 * Retry failed M2.5 entities with reduced context budget.
 * Usage: CONTEXT_TOKEN_BUDGET=40000 npx tsx scripts/retry-failed-m25.ts
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

const FAILED_ENTITY_IDS = [
  "057bf7a7-20c1-4fa8-a924-fa870ff1f635",
  "1988a839-3d10-40ea-b96e-e485b0372e1c",
  "37b4b155-9945-449d-9028-741489f66c87",
  "42dca860-f969-4ff5-af43-11d7ed717bce",
  "8d32622b-248d-4ee8-97b6-314703a6a2ff",
  "8fe76f1b-985f-4543-b511-7458319baaff",
  "94c1e3f3-2f1b-4740-96c3-87bdccb5e1a8",
  "9b3b3dc2-112d-441a-a339-c2596cd88e89",
  "a25d901d-23b3-44aa-a126-1c0913697c9d",
  "c4cac8fc-bf5c-4ad1-a33c-e593b5c20732",
  "f1c478e9-8243-491e-8387-ee40491390ac",
];

async function main() {
  const { createBatchRun, executeBatchRun } = await import("../src/lib/generation/batch-runner");
  const { db } = await import("../src/lib/db");
  const { entity, user } = await import("../src/lib/db/schema");

  const [firstEntity] = await db.select().from(entity).limit(1);
  const WORKSPACE_ID = firstEntity.workspaceId;
  const [firstUser] = await db.select().from(user).limit(1);
  const USER_ID = firstUser.id;

  const budget = process.env.CONTEXT_TOKEN_BUDGET || "80000";
  console.log(`\n=== Retrying ${FAILED_ENTITY_IDS.length} failed M2.5 entities (${budget} context budget) ===\n`);

  const batchInput = {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    preferredProvider: "claude" as const,
    outputFormat: "yaml" as const,
    enableStructureClassification: true,
    entityIds: FAILED_ENTITY_IDS,
    includeStatuses: ["unmapped", "unreviewed", "punted", "needs_discussion", "excluded"] as any,
    milestone: "M2.5",
  };

  const { batchRunId, entities: batches, totalFields } = await createBatchRun(batchInput);
  console.log(`Batch run ${batchRunId}: ${batches.length} entities, ${totalFields} eligible fields\n`);

  await executeBatchRun(batchRunId, batches, batchInput);

  console.log(`\nDone.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
