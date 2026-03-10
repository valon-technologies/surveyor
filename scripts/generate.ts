#!/usr/bin/env npx tsx --env-file=.env.local
/**
 * Unified mapping generation script.
 *
 * SDT (VDS Review) generation:
 *   npx tsx --env-file=.env.local scripts/generate.ts --milestone M2.5 --dry-run
 *   npx tsx --env-file=.env.local scripts/generate.ts --milestone M2.5 --gaps-only
 *   npx tsx --env-file=.env.local scripts/generate.ts --milestone M2.5 --with-reviews
 *   npx tsx --env-file=.env.local scripts/generate.ts --entity foreclosure --entity loan
 *   npx tsx --env-file=.env.local scripts/generate.ts --milestone M2.5 --model claude-sonnet-4-6
 *
 * Transfer generation:
 *   npx tsx --env-file=.env.local scripts/generate.ts --transfer <id> --dry-run
 *   npx tsx --env-file=.env.local scripts/generate.ts --transfer <id> --domain arm
 *   npx tsx --env-file=.env.local scripts/generate.ts --transfer <id> --tier 2
 *
 * Flags:
 *   --milestone <M2|M2.5|M3>   Scope SDT generation by milestone
 *   --gaps-only                 Only generate for fields with no existing mapping
 *   --entity <name>             Scope to specific entity (repeatable)
 *   --with-reviews              Run AI review pass after generation
 *   --transfer <id>             Run transfer generation instead of SDT
 *   --domain <name>             Transfer: scope to domain
 *   --tier <1|2>                Transfer: tier filter
 *   --model <id>                Override model (default: claude-opus-4-6)
 *   --include-confirmed         Transfer: include confirmed-correct fields
 *   --dry-run                   Show scope and cost estimate without running
 */

// ─── CLI parsing ───────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function getArgAll(flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) values.push(args[++i]);
  }
  return values;
}

const transferId = getArg("--transfer") || getArg("-t");
const milestone = getArg("--milestone");
const entityNames = getArgAll("--entity");
const domainFilter = getArg("--domain");
const tierFilter = getArg("--tier");
const modelArg = getArg("--model");
const gapsOnly = args.includes("--gaps-only");
const withReviews = args.includes("--with-reviews");
const dryRun = args.includes("--dry-run");
const includeConfirmed = args.includes("--include-confirmed");

if (!transferId && !milestone && entityNames.length === 0) {
  console.error(`Usage: npx tsx --env-file=.env.local scripts/generate.ts [options]

SDT generation:
  --milestone <M2|M2.5|M3>   Required for SDT (unless --entity specified)
  --gaps-only                 Only fields with no existing mapping
  --entity <name>             Scope to entity (repeatable)
  --with-reviews              Chain AI reviews after generation
  --model <id>                Model override
  --dry-run                   Show scope without running

Transfer generation:
  --transfer <id>             Transfer UUID (required for transfers)
  --domain <name>             Scope to domain
  --tier <1|2>                Tier filter (default: tier 1)
  --model <id>                Model override
  --include-confirmed         Include confirmed fields
  --dry-run                   Show scope without running`);
  process.exit(1);
}

// ─── SDT generation ────────────────────────────────────────
async function runSdt() {
  const { db } = await import("../src/lib/db");
  const { entity, field, fieldMapping, user } = await import("../src/lib/db/schema");
  const { eq, and, inArray, isNull } = await import("drizzle-orm");
  const { createBatchRun, executeBatchRun } = await import("../src/lib/generation/batch-runner");

  const [firstEntity] = await db.select().from(entity).limit(1);
  if (!firstEntity) { console.error("No entities"); process.exit(1); }
  const WORKSPACE_ID = firstEntity.workspaceId;

  const [firstUser] = await db.select().from(user).limit(1);
  if (!firstUser) { console.error("No users"); process.exit(1); }
  const USER_ID = firstUser.id;

  // Resolve entity scope
  let entityIds: string[] | undefined;

  if (entityNames.length > 0) {
    // Explicit entity names
    entityIds = [];
    for (const name of entityNames) {
      const [ent] = await db.select().from(entity)
        .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.name, name), eq(entity.side, "target")));
      if (!ent) {
        console.log(`Entity "${name}" not found — skipping`);
        continue;
      }
      entityIds.push(ent.id);
      console.log(`Found: ${name}`);
    }
    if (entityIds.length === 0) { console.error("No valid entities"); process.exit(1); }
  } else if (milestone) {
    // Find entities with fields matching milestone
    const milestoneFields = await db
      .select({ entityId: field.entityId, fieldId: field.id })
      .from(field)
      .where(eq(field.milestone, milestone));

    const entityIdSet = new Set(milestoneFields.map(f => f.entityId));

    if (gapsOnly) {
      // Filter to only fields without mapping records
      const fieldIds = milestoneFields.map(f => f.fieldId);
      const existingMappings = fieldIds.length > 0
        ? await db.select({ targetFieldId: fieldMapping.targetFieldId })
            .from(fieldMapping)
            .where(and(
              eq(fieldMapping.isLatest, true),
              isNull(fieldMapping.transferId),
              inArray(fieldMapping.targetFieldId, fieldIds),
            ))
        : [];
      const mappedIds = new Set(existingMappings.map(m => m.targetFieldId));
      const gapFields = milestoneFields.filter(f => !mappedIds.has(f.fieldId));
      const gapEntityIds = new Set(gapFields.map(f => f.entityId));
      entityIds = Array.from(gapEntityIds);

      console.log(`${milestone} fields: ${milestoneFields.length} total, ${mappedIds.size} mapped, ${gapFields.length} gaps across ${entityIds.length} entities`);
    } else {
      entityIds = Array.from(entityIdSet);
      console.log(`${milestone} fields: ${milestoneFields.length} across ${entityIds.length} entities`);
    }

    if (entityIds.length === 0) { console.log("Nothing to generate"); process.exit(0); }
  }

  const includeStatuses = gapsOnly
    ? ["unmapped" as const]
    : ["unmapped" as const, "unreviewed" as const, "punted" as const, "needs_discussion" as const, "excluded" as const];

  const batchInput = {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    preferredProvider: "claude" as const,
    outputFormat: "yaml" as const,
    enableStructureClassification: true,
    entityIds,
    includeStatuses: includeStatuses as any,
    milestone: milestone || undefined,
    model: modelArg || undefined,
  };

  const { batchRunId, entities: batches, totalFields } = await createBatchRun(batchInput);
  console.log(`\nBatch run ${batchRunId}: ${batches.length} entities, ${totalFields} eligible fields`);

  for (const b of batches) {
    console.log(`  ${b.entityName}: ${b.fieldCount} fields`);
  }

  if (dryRun) {
    // Rough cost: ~$2-3/entity with Opus
    const estCost = batches.length * 2.5;
    console.log(`\n[dry-run] Estimated cost: ~$${estCost.toFixed(0)} (${batches.length} entities × ~$2.50/entity with Opus)`);
    process.exit(0);
  }

  if (totalFields === 0 && gapsOnly) {
    console.log("\nNo eligible fields via batch runner. Trying per-entity with explicit field IDs...");

    const { startGeneration, executeGeneration, saveMappingsAndQuestions } = await import("../src/lib/generation/runner");

    // Rebuild gap field list
    const milestoneFields = await db
      .select({ entityId: field.entityId, fieldId: field.id })
      .from(field)
      .innerJoin(entity, eq(field.entityId, entity.id))
      .where(and(eq(entity.side, "target"), eq(field.milestone, milestone!)));

    const fieldIds = milestoneFields.map(f => f.fieldId);
    const existingMappings = fieldIds.length > 0
      ? await db.select({ targetFieldId: fieldMapping.targetFieldId })
          .from(fieldMapping)
          .where(and(eq(fieldMapping.isLatest, true), isNull(fieldMapping.transferId), inArray(fieldMapping.targetFieldId, fieldIds)))
      : [];
    const mappedIds = new Set(existingMappings.map(m => m.targetFieldId));

    const gapByEntity = new Map<string, string[]>();
    for (const f of milestoneFields) {
      if (mappedIds.has(f.fieldId)) continue;
      const list = gapByEntity.get(f.entityId) || [];
      list.push(f.fieldId);
      gapByEntity.set(f.entityId, list);
    }

    const allEntities = await db.select().from(entity)
      .where(and(eq(entity.workspaceId, WORKSPACE_ID), eq(entity.side, "target")));
    const entityById = new Map(allEntities.map(e => [e.id, e]));

    let totalCreated = 0;
    let totalErrors = 0;

    for (const [eId, fIds] of gapByEntity.entries()) {
      const e = entityById.get(eId);
      const name = e?.displayName || e?.name || eId;
      console.log(`  ${name} (${fIds.length} fields)...`);

      try {
        const { startResult, prepared } = await startGeneration({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          entityId: eId,
          generationType: "field_mapping",
          outputFormat: "yaml",
          preferredProvider: "claude",
          fieldIds: fIds,
        });

        if (startResult.status === "skipped") {
          console.log(`    Skipped: ${startResult.reason}`);
          continue;
        }

        await executeGeneration(prepared);
        const saved = await saveMappingsAndQuestions(prepared, WORKSPACE_ID);
        totalCreated += saved.mappingsCreated;
        console.log(`    Created ${saved.mappingsCreated} mappings`);
      } catch (err) {
        console.error(`    Error: ${err instanceof Error ? err.message : err}`);
        totalErrors++;
      }
    }

    console.log(`\nGeneration done: ${totalCreated} created, ${totalErrors} errors`);
  } else if (totalFields > 0) {
    console.log(`\nStarting generation...\n`);
    await executeBatchRun(batchRunId, batches, batchInput);
    console.log(`\nGeneration complete.`);
  } else {
    console.log("\nNo eligible fields found.");
    process.exit(0);
  }

  // AI reviews
  if (withReviews) {
    console.log(`\n=== AI Reviews ===`);
    const { generateAiReview } = await import("../src/lib/generation/ai-review");
    const { sql } = await import("drizzle-orm");

    let reviewCount = 0;
    let reviewErrors = 0;

    for (const batch of batches) {
      const mappings = await db
        .select({ id: fieldMapping.id })
        .from(fieldMapping)
        .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
        .where(and(
          eq(field.entityId, batch.entityId),
          eq(fieldMapping.isLatest, true),
          isNull(fieldMapping.transferId),
          sql`${fieldMapping.aiReview} IS NULL`,
          sql`${fieldMapping.status} NOT IN ('excluded', 'accepted')`,
        ));

      if (mappings.length === 0) continue;
      console.log(`[${batch.entityName}] ${mappings.length} mappings`);

      const PARALLEL = 3;
      for (let i = 0; i < mappings.length; i += PARALLEL) {
        const chunk = mappings.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(
          chunk.map(m => generateAiReview(WORKSPACE_ID, m.id))
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) reviewCount++;
          else reviewErrors++;
        }
      }
    }

    console.log(`\nAI reviews: ${reviewCount} generated, ${reviewErrors} errors`);
  }

  console.log(`\nDone.`);
  process.exit(0);
}

// ─── Transfer generation ───────────────────────────────────
async function runTransfer() {
  // Delegate to existing transfer script with passthrough args
  // The transfer script is complex enough (corrections engine, domain batching,
  // source field resolution, mapping_context linking) that wrapping it would
  // just duplicate code. Instead, exec it.
  const { execSync } = await import("child_process");
  const passArgs = args.filter(a => a !== "--transfer" && a !== transferId);
  const cmd = `npx tsx --env-file=.env.local scripts/run-transfer-generation.ts --transfer-id ${transferId} ${passArgs.join(" ")}`;
  console.log(`Delegating to transfer script...\n`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
  } catch (err: any) {
    process.exit(err.status || 1);
  }
}

// ─── Main ──────────────────────────────────────────────────
if (transferId) {
  runTransfer();
} else {
  runSdt().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
