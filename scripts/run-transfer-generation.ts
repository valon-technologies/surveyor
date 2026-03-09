#!/usr/bin/env npx tsx
/**
 * Run transfer mapping generation for one or more domains.
 *
 * Cost-conscious design:
 * - --dry-run shows estimated cost without calling LLM
 * - --domain filters to a single domain (start small!)
 * - --tier 1|2 selects tier (default: tier 1 only)
 * - --model selects model (default: opus for tier 1, haiku for tier 2)
 * - Hard overrides bypass LLM (free)
 * - Confirmed-correct fields skip by default (--include-confirmed to override)
 *
 * Usage:
 *   npx tsx scripts/run-transfer-generation.ts --transfer-id <uuid> --dry-run
 *   npx tsx scripts/run-transfer-generation.ts --transfer-id <uuid> --domain arm
 *   npx tsx scripts/run-transfer-generation.ts --transfer-id <uuid> --domain loans --model claude-sonnet-4-6
 */

import { readFileSync } from "fs";
import { join } from "path";
import { db } from "../src/lib/db";
import {
  transfer,
  transferCorrection,
  fieldMapping,
  field,
  entity,
  generation,
  batchRun,
  context,
  skill,
  skillContext,
  learning,
  userWorkspace,
  mappingContext,
} from "../src/lib/db/schema";
import { eq, and, inArray, isNull, desc } from "drizzle-orm";
import { resolveProvider } from "../src/lib/generation/provider-resolver";
import {
  buildTransferPrompt,
  buildTier2Prompt,
  type TransferVdsField,
  type TransferSourceField,
} from "../src/lib/generation/transfer-prompt-builder";
import {
  parseTransferResponse,
  resolveTransferMappings,
  type TransferResolutionContext,
} from "../src/lib/generation/transfer-output-parser";
import {
  loadCorrections,
  buildCorrectionsContext,
  applyHardOverrides,
  generateOverrideOutputs,
} from "../src/lib/transfer/corrections-engine";
import {
  TIER1_DOMAINS,
  SYSTEM_FIELDS,
  estimateCost,
  type ModelId,
} from "../src/lib/transfer/domain-config";

// ─── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const transferId = getArg("--transfer-id") || getArg("-t");
const domainFilter = getArg("--domain");
const tierFilter = getArg("--tier"); // "1" or "2"
const modelArg = getArg("--model") as ModelId | undefined;
const dryRun = args.includes("--dry-run");
const includeConfirmed = args.includes("--include-confirmed");

if (!transferId) {
  console.error(`Usage: npx tsx scripts/run-transfer-generation.ts --transfer-id <uuid> [options]

Options:
  --dry-run              Show cost estimate, don't call LLM
  --domain <name>        Run single domain (e.g. arm, borrower, loans)
  --tier 1|2             Run tier 1 (data domains) or tier 2 (workflow domains)
  --model <id>           Model to use (claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5)
  --include-confirmed    Include fields already confirmed correct`);
  process.exit(1);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  console.log("=== Transfer Mapping Generation ===\n");
  if (dryRun) console.log("DRY RUN — no LLM calls\n");

  // 1. Load transfer
  const [t] = await db
    .select()
    .from(transfer)
    .where(eq(transfer.id, transferId!));
  if (!t) { console.error(`Transfer ${transferId} not found`); process.exit(1); }
  console.log(`Transfer: ${t.name} (${t.clientName || "no client"})`);

  // 2. Load user for provider resolution
  const [member] = await db
    .select({ userId: userWorkspace.userId })
    .from(userWorkspace)
    .where(eq(userWorkspace.workspaceId, t.workspaceId))
    .limit(1);
  const userId = member?.userId || "";

  // 3. Load source fields
  const sourceEntity = await db
    .select({ id: entity.id })
    .from(entity)
    .innerJoin(field, eq(field.entityId, entity.id))
    .where(
      and(
        eq(entity.workspaceId, t.workspaceId),
        eq(entity.side, "source"),
        // Find entity linked to this transfer's schema asset
      )
    )
    .limit(1);

  // Get all source fields from entities with side="source" linked to this transfer's schema asset
  const sourceFields: TransferSourceField[] = [];
  if (t.sourceSchemaAssetId) {
    const sourceEntities = await db
      .select({ id: entity.id })
      .from(entity)
      .where(
        and(
          eq(entity.schemaAssetId, t.sourceSchemaAssetId),
          eq(entity.side, "source"),
        )
      );

    if (sourceEntities.length > 0) {
      const entityIds = sourceEntities.map(e => e.id);
      const fields = await db
        .select({
          name: field.name,
          position: field.position,
          sampleValues: field.sampleValues,
        })
        .from(field)
        .where(inArray(field.entityId, entityIds));

      for (const f of fields) {
        sourceFields.push({
          position: f.position ?? 0,
          fieldName: f.name,
          sampleValue: (f.sampleValues as string[])?.[0] || "",
        });
      }
      sourceFields.sort((a, b) => a.position - b.position);
    }
  }
  console.log(`Source fields: ${sourceFields.length}`);

  // 4. Load target VDS fields grouped by domain
  const targetEntities = await db
    .select({
      entityId: entity.id,
      entityName: entity.name,
      domainTags: entity.domainTags,
    })
    .from(entity)
    .where(
      and(
        eq(entity.workspaceId, t.workspaceId),
        eq(entity.side, "target"),
      )
    );

  const targetFields = await db
    .select({
      id: field.id,
      entityId: field.entityId,
      name: field.name,
      dataType: field.dataType,
      isRequired: field.isRequired,
      description: field.description,
      enumValues: field.enumValues,
    })
    .from(field)
    .where(
      inArray(field.entityId, targetEntities.map(e => e.entityId))
    );

  // Build entity lookup
  const entityById = new Map(targetEntities.map(e => [e.entityId, e]));

  // Group fields by domain
  type DomainBatch = { domain: string; entities: string[]; fields: TransferVdsField[]; fieldIds: Map<string, string> };
  const domainBatches = new Map<string, DomainBatch>();

  for (const f of targetFields) {
    if (SYSTEM_FIELDS.has(f.name)) continue;
    const ent = entityById.get(f.entityId);
    if (!ent) continue;
    const domain = (ent.domainTags as string[])?.[0] || "unknown";

    if (!domainBatches.has(domain)) {
      domainBatches.set(domain, { domain, entities: [], fields: [], fieldIds: new Map() });
    }
    const batch = domainBatches.get(domain)!;
    if (!batch.entities.includes(ent.entityName)) batch.entities.push(ent.entityName);
    batch.fields.push({
      entity: ent.entityName,
      field: f.name,
      dataType: f.dataType,
      isRequired: f.isRequired,
      description: f.description,
      enumValues: f.enumValues as string[] | null,
    });
    batch.fieldIds.set(`${ent.entityName}.${f.name}`, f.id);
  }

  console.log(`Target domains: ${domainBatches.size} (${targetFields.length} non-system fields)`);

  // 5. Load corrections
  const corrections = await loadCorrections(transferId!);
  console.log(`Corrections: ${corrections.totalOverrides} overrides, ${corrections.totalInjections} injections`);

  // 5b. Load context: foundational docs (distilled learnings, prioritized by token budget)
  // Cap at 8K tokens — the distilled-learnings doc (~4.4K) is the most valuable;
  // remaining budget fills with domain knowledge docs sorted by size (smaller = more focused)
  const FOUNDATIONAL_TOKEN_BUDGET = 8000;
  const foundationalDocs = await db
    .select({ name: context.name, content: context.content, tokenCount: context.tokenCount })
    .from(context)
    .where(
      and(
        eq(context.workspaceId, t.workspaceId),
        eq(context.category, "foundational"),
        eq(context.isActive, true),
      )
    );

  // Prioritize: docs with "learning" or "distill" in name first, then smallest docs
  const sorted = foundationalDocs.sort((a, b) => {
    const aIsLearning = /learn|distill/i.test(a.name) ? 0 : 1;
    const bIsLearning = /learn|distill/i.test(b.name) ? 0 : 1;
    if (aIsLearning !== bIsLearning) return aIsLearning - bIsLearning;
    return (a.tokenCount || 0) - (b.tokenCount || 0);
  });

  let learningsTokens = 0;
  const selectedDocs: string[] = [];
  for (const d of sorted) {
    const tokens = d.tokenCount || Math.ceil((d.content?.length || 0) / 4);
    if (learningsTokens + tokens > FOUNDATIONAL_TOKEN_BUDGET && selectedDocs.length > 0) break;
    selectedDocs.push(d.content);
    learningsTokens += tokens;
  }
  // Load flow-transfer-principles from disk (transfer-specific, not in shared context table)
  const principlesPath = join(__dirname, "../data/transfers/flow-transfer-principles.md");
  let principlesText = "";
  try {
    principlesText = readFileSync(principlesPath, "utf-8");
    console.log(`Flow transfer principles: loaded (~${Math.ceil(principlesText.length / 4)} tokens)`);
  } catch {
    console.log(`Flow transfer principles: not found at ${principlesPath}, skipping`);
  }

  const learningsText = [principlesText, ...selectedDocs].filter(Boolean).join("\n\n---\n\n");
  console.log(`Foundational context: ${selectedDocs.length}/${foundationalDocs.length} docs (~${learningsTokens} tokens, budget ${FOUNDATIONAL_TOKEN_BUDGET})`);

  // 5b2. Load ACDC reference context (enum maps, step codes) — for understanding, NOT as source fields
  const ACDC_REFERENCE_TOKEN_BUDGET = 10000;
  const acdcDocs = await db
    .select({ name: context.name, content: context.content, tokenCount: context.tokenCount })
    .from(context)
    .where(
      and(
        eq(context.workspaceId, t.workspaceId),
        eq(context.subcategory, "enum_map"),
        eq(context.isActive, true),
      )
    );

  let acdcTokens = 0;
  const selectedAcdcDocs: { name: string; content: string }[] = [];
  // Sort by token count ascending so we fit more docs
  const sortedAcdc = acdcDocs.sort((a, b) => (a.tokenCount || 0) - (b.tokenCount || 0));
  for (const d of sortedAcdc) {
    if (!d.content) continue;
    const tokens = d.tokenCount || Math.ceil(d.content.length / 4);
    if (acdcTokens + tokens > ACDC_REFERENCE_TOKEN_BUDGET && selectedAcdcDocs.length > 0) break;
    selectedAcdcDocs.push({ name: d.name, content: d.content });
    acdcTokens += tokens;
  }
  console.log(`ACDC reference context: ${selectedAcdcDocs.length}/${acdcDocs.length} enum/lookup docs (~${acdcTokens} tokens, budget ${ACDC_REFERENCE_TOKEN_BUDGET})`);

  // 5c. Load VDS entity skill docs (per-entity documentation)
  // Build a map: entityName → assembled skill text
  const entitySkillText = new Map<string, string>();
  const allSkills = await db
    .select({ id: skill.id, name: skill.name, applicability: skill.applicability })
    .from(skill)
    .where(and(eq(skill.workspaceId, t.workspaceId), eq(skill.isActive, true)));

  for (const s of allSkills) {
    const patterns = (s.applicability as { entityPatterns?: string[] })?.entityPatterns || [];
    // Load skill's primary + reference contexts
    const skillContexts = await db
      .select({ content: context.content, name: context.name, role: skillContext.role })
      .from(skillContext)
      .innerJoin(context, eq(skillContext.contextId, context.id))
      .where(
        and(
          eq(skillContext.skillId, s.id),
          eq(context.isActive, true),
        )
      )
      .orderBy(skillContext.sortOrder);

    if (skillContexts.length === 0) continue;

    const text = skillContexts
      .filter(sc => sc.role === "primary" || sc.role === "reference")
      .map(sc => sc.content)
      .join("\n\n");

    // Map to each matching entity pattern
    for (const pattern of patterns) {
      const existing = entitySkillText.get(pattern) || "";
      entitySkillText.set(pattern, existing + (existing ? "\n\n---\n\n" : "") + text);
    }
  }
  console.log(`Entity skills loaded: ${entitySkillText.size} entity patterns`);

  // 5d. Load workspace-scope learnings (validated corrections from reviews)
  const workspaceRules = await db
    .select({ content: learning.content })
    .from(learning)
    .where(
      and(
        eq(learning.workspaceId, t.workspaceId),
        eq(learning.scope, "workspace"),
      )
    )
    .orderBy(desc(learning.createdAt))
    .limit(20);
  if (workspaceRules.length > 0) {
    console.log(`Workspace rules: ${workspaceRules.length}`);
  }

  // 6. Filter domains
  let domainsToRun: string[] = [];
  if (domainFilter) {
    if (!domainBatches.has(domainFilter)) {
      console.error(`Domain "${domainFilter}" not found. Available: ${Array.from(domainBatches.keys()).sort().join(", ")}`);
      process.exit(1);
    }
    domainsToRun = [domainFilter];
  } else if (tierFilter === "2") {
    domainsToRun = Array.from(domainBatches.keys()).filter(d => !TIER1_DOMAINS.has(d));
  } else {
    // Default: tier 1 only
    domainsToRun = Array.from(domainBatches.keys()).filter(d => TIER1_DOMAINS.has(d));
  }

  console.log(`\nDomains to run (${domainsToRun.length}): ${domainsToRun.sort().join(", ")}`);

  // 7. Cost estimation
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalFieldsToGenerate = 0;
  let totalFieldsOverridden = 0;
  let totalFieldsSkipped = 0;

  const model: ModelId = modelArg || (tierFilter === "2" ? "claude-haiku-4-5" : "claude-opus-4-6");

  const batchPlans: Array<{
    domain: string;
    batch: DomainBatch;
    fieldsToGenerate: number;
    overrideCount: number;
    skipCount: number;
    prompt: { systemMessage: string; userMessage: string; estimatedInputTokens: number } | null;
  }> = [];

  for (const domain of domainsToRun) {
    const batch = domainBatches.get(domain)!;

    // Count fields with hard overrides (skip LLM)
    let overrideCount = 0;
    let skipCount = 0;
    const fieldsForLLM: TransferVdsField[] = [];

    for (const f of batch.fields) {
      const key = `${f.entity}.${f.field}`;
      if (corrections.hardOverrides.has(key)) {
        overrideCount++;
        continue;
      }
      // Skip confirmed-correct unless --include-confirmed
      // (We'd need to check existing mapping verdicts, simplified here)
      fieldsForLLM.push(f);
    }

    if (fieldsForLLM.length === 0) {
      batchPlans.push({ domain, batch, fieldsToGenerate: 0, overrideCount, skipCount, prompt: null });
      totalFieldsOverridden += overrideCount;
      continue;
    }

    // Build corrections context for this domain
    const corrContext = buildCorrectionsContext(
      corrections.promptInjections,
      batch.entities,
    );

    // Assemble entity skill docs for this domain's entities (cap at 20K tokens)
    const SKILL_TOKEN_BUDGET = 20000;
    const domainSkillParts: string[] = [];
    let skillTokensUsed = 0;
    for (const entityName of batch.entities) {
      const skillText = entitySkillText.get(entityName);
      if (skillText) {
        const tokens = Math.ceil(skillText.length / 4);
        if (skillTokensUsed + tokens > SKILL_TOKEN_BUDGET && domainSkillParts.length > 0) break;
        domainSkillParts.push(skillText);
        skillTokensUsed += tokens;
      }
    }
    const domainSkillsText = domainSkillParts.join("\n\n---\n\n");

    // Combine learnings + workspace rules
    const fullLearningsText = [
      learningsText,
      ...workspaceRules.map(r => r.content),
    ].filter(Boolean).join("\n\n---\n\n");

    // Build prompt
    // Build ACDC reference text for this domain's entities
    const domainAcdcText = selectedAcdcDocs.length > 0
      ? selectedAcdcDocs.map(d => `### ${d.name}\n\n${d.content}`).join("\n\n")
      : undefined;

    const prompt = buildTransferPrompt({
      domain,
      vdsFields: fieldsForLLM,
      sourceFields,
      skillsText: domainSkillsText,
      learningsText: fullLearningsText,
      correctionsContext: corrContext,
      clientName: t.clientName || t.name,
      acdcReferenceText: domainAcdcText,
    });

    // Estimate output tokens (~150 tokens per field)
    const estOutputTokens = fieldsForLLM.length * 150;

    totalInputTokens += prompt.estimatedInputTokens;
    totalOutputTokens += estOutputTokens;
    totalFieldsToGenerate += fieldsForLLM.length;
    totalFieldsOverridden += overrideCount;
    totalFieldsSkipped += skipCount;

    batchPlans.push({
      domain,
      batch,
      fieldsToGenerate: fieldsForLLM.length,
      overrideCount,
      skipCount,
      prompt,
    });
  }

  // Print cost estimate
  const estCost = estimateCost(totalInputTokens, totalOutputTokens, model);
  console.log(`\n─── Cost Estimate ───`);
  console.log(`Model: ${model}`);
  console.log(`Fields to generate: ${totalFieldsToGenerate}`);
  console.log(`Fields via hard override (free): ${totalFieldsOverridden}`);
  console.log(`Estimated input tokens: ${totalInputTokens.toLocaleString()}`);
  console.log(`Estimated output tokens: ${totalOutputTokens.toLocaleString()}`);
  console.log(`Estimated cost: $${estCost.toFixed(2)}`);
  console.log(`\nPer domain:`);
  for (const plan of batchPlans) {
    const fields = plan.fieldsToGenerate;
    const overrides = plan.overrideCount;
    const inputTok = plan.prompt?.estimatedInputTokens || 0;
    const outputTok = fields * 150;
    const cost = estimateCost(inputTok, outputTok, model);
    console.log(`  ${plan.domain.padEnd(25)} ${fields.toString().padStart(4)} fields  ${overrides ? `+${overrides} overrides  ` : ""}~$${cost.toFixed(2)}`);
  }

  if (dryRun) {
    console.log("\nDry run complete. Use without --dry-run to execute.");
    process.exit(0);
  }

  // 8. Execute generation
  console.log(`\n─── Executing ───`);

  const { provider, providerName } = await resolveProvider(userId, "claude");
  console.log(`Provider: ${providerName}`);

  // Build source field lookup for resolution
  const sourceFieldLookup = new Map<string, { id: string; position: number }>();
  // We need source field IDs from the DB
  if (t.sourceSchemaAssetId) {
    const sourceEntities = await db
      .select({ id: entity.id })
      .from(entity)
      .where(eq(entity.schemaAssetId, t.sourceSchemaAssetId));
    if (sourceEntities.length > 0) {
      const srcFields = await db
        .select({ id: field.id, name: field.name, position: field.position })
        .from(field)
        .where(inArray(field.entityId, sourceEntities.map(e => e.id)));
      for (const f of srcFields) {
        sourceFieldLookup.set(f.name, { id: f.id, position: f.position ?? 0 });
      }
    }
  }

  let totalCreated = 0;
  let totalErrors = 0;

  for (const plan of batchPlans) {
    if (!plan.prompt) {
      // All fields were overridden — generate synthetic outputs
      const overrideOutputs = generateOverrideOutputs(corrections.hardOverrides, plan.batch.entities);
      if (overrideOutputs.length > 0) {
        const ctx: TransferResolutionContext = {
          targetFieldIds: plan.batch.fieldIds,
          sourceFieldIds: sourceFieldLookup,
        };
        const resolved = resolveTransferMappings(overrideOutputs, ctx);
        const created = await saveMappings(resolved, t.workspaceId, transferId!, null);
        totalCreated += created;
        console.log(`  ${plan.domain}: ${overrideOutputs.length} override-only fields saved`);
      }
      continue;
    }

    console.log(`\n  ${plan.domain} (${plan.fieldsToGenerate} fields)...`);
    const start = Date.now();

    try {
      // Call LLM
      const response = await provider.generateCompletion({
        systemMessage: plan.prompt.systemMessage,
        userMessage: plan.prompt.userMessage,
        model: model === "claude-haiku-4-5" ? "claude-haiku-4-5-20251001" : model,
        maxTokens: 32768,
        temperature: 0,
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const actualCost = estimateCost(response.inputTokens, response.outputTokens, model);
      console.log(`    LLM: ${response.inputTokens.toLocaleString()} in / ${response.outputTokens.toLocaleString()} out  ${elapsed}s  $${actualCost.toFixed(2)}`);

      // Parse output
      let parsed = parseTransferResponse(response.content);
      console.log(`    Parsed: ${parsed.length} mappings`);

      // Apply hard overrides
      const { mappings: withOverrides, applied } = applyHardOverrides(parsed, corrections.hardOverrides);
      if (applied > 0) console.log(`    Applied ${applied} hard overrides`);

      // Also add override-only fields not in LLM output
      const overrideExtras = generateOverrideOutputs(corrections.hardOverrides, plan.batch.entities)
        .filter(o => !withOverrides.some(m => m.vds_entity === o.vds_entity && m.vds_field === o.vds_field));
      const allMappings = [...withOverrides, ...overrideExtras];

      // Resolve to DB records
      const ctx: TransferResolutionContext = {
        targetFieldIds: plan.batch.fieldIds,
        sourceFieldIds: sourceFieldLookup,
      };
      const resolved = resolveTransferMappings(allMappings, ctx);

      // Log warnings
      const warnings = resolved.filter(r => r.warnings.length > 0);
      if (warnings.length > 0) {
        console.log(`    Warnings: ${warnings.length} fields`);
        for (const w of warnings.slice(0, 3)) {
          console.log(`      ${w.targetEntity}.${w.targetField}: ${w.warnings.join("; ")}`);
        }
      }

      // Save to DB
      const created = await saveMappings(resolved, t.workspaceId, transferId!, response.model);
      totalCreated += created;
      console.log(`    Saved: ${created} field_mapping records`);

      // Populate mapping_context junction — link each field's context_used to context docs
      // For transfers, context_used is free text. Extract any ctx_ID refs, and also
      // try to match context doc names mentioned in the text.
      if (resolved.length > 0) {
        // Get all context docs that were in the prompt (foundational + skills + ACDC)
        const allPromptContextIds = new Set<string>();
        const allContextDocs = await db
          .select({ id: context.id, name: context.name })
          .from(context)
          .where(eq(context.workspaceId, t.workspaceId));

        const contextByNameLower = new Map<string, string>();
        for (const c of allContextDocs) {
          contextByNameLower.set(c.name.toLowerCase(), c.id);
        }

        const mcRows: { fieldMappingId: string; contextId: string; contextType: string }[] = [];

        // For each saved mapping, find the field_mapping ID and link context
        for (const r of resolved) {
          if (!r.targetFieldId) continue;
          const [fm] = await db
            .select({ id: fieldMapping.id })
            .from(fieldMapping)
            .where(
              and(
                eq(fieldMapping.targetFieldId, r.targetFieldId),
                eq(fieldMapping.transferId, transferId!),
                eq(fieldMapping.isLatest, true),
              )
            )
            .limit(1);
          if (!fm) continue;

          // Extract [ref:ctx_*] citations from reasoning + contextUsed
          const text = [r.reasoning, r.contextUsed].filter(Boolean).join(" ");
          const refMatches = text.match(/\[ref:ctx_([^\]]+)\]/g);
          if (refMatches) {
            for (const ref of refMatches) {
              const id = ref.replace("[ref:ctx_", "").replace("]", "");
              if (contextByNameLower.has(id) || allContextDocs.some(c => c.id === id)) {
                mcRows.push({ fieldMappingId: fm.id, contextId: id, contextType: "context_reference" });
              }
            }
          }
        }

        if (mcRows.length > 0) {
          for (let i = 0; i < mcRows.length; i += 500) {
            await db.insert(mappingContext).values(mcRows.slice(i, i + 500));
          }
          console.log(`    Context links: ${mcRows.length} mapping_context records`);
        }
      }

      // Save generation record
      await db.insert(generation).values({
        workspaceId: t.workspaceId,
        generationType: "transfer_mapping",
        status: "completed",
        provider: providerName,
        model: response.model,
        promptSnapshot: {
          systemMessage: plan.prompt.systemMessage,
          userMessage: plan.prompt.userMessage.slice(0, 5000), // truncate for storage
          skillsUsed: [],
        },
        output: response.content.slice(0, 50000),
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        durationMs: Date.now() - start,
        transferId: transferId!,
      });

    } catch (err) {
      console.error(`    ERROR: ${err}`);
      totalErrors++;
    }
  }

  // Update transfer stats
  const allMappings = await db
    .select({
      status: fieldMapping.status,
      confidence: fieldMapping.confidence,
      sourceFieldId: fieldMapping.sourceFieldId,
    })
    .from(fieldMapping)
    .where(and(eq(fieldMapping.transferId, transferId!), eq(fieldMapping.isLatest, true)));

  const mapped = allMappings.filter(m => m.status !== "unmapped" && m.sourceFieldId);
  await db
    .update(transfer)
    .set({
      stats: {
        ...(t.stats as Record<string, unknown> || {}),
        totalTargetFields: totalFieldsToGenerate + totalFieldsOverridden,
        mappedCount: mapped.length,
        unmappedCount: allMappings.length - mapped.length,
        coveragePercent: allMappings.length > 0 ? (mapped.length / allMappings.length) * 100 : 0,
        highCount: mapped.filter(m => m.confidence === "high").length,
        mediumCount: mapped.filter(m => m.confidence === "medium").length,
        lowCount: mapped.filter(m => m.confidence === "low").length,
        lastGeneratedAt: new Date().toISOString(),
      },
      status: "reviewing",
    })
    .where(eq(transfer.id, transferId!));

  console.log(`\n─── Summary ───`);
  console.log(`Created: ${totalCreated} field_mapping records`);
  console.log(`Errors: ${totalErrors} domains failed`);
  console.log(`Transfer status → reviewing`);

  process.exit(totalErrors > 0 ? 1 : 0);
}

/**
 * Save resolved mappings to field_mapping table with copy-on-write versioning.
 *
 * If a prior mapping exists for the same targetFieldId + transferId:
 * - The old mapping is marked isLatest=false (preserving its verdicts/feedback)
 * - The new mapping gets version=old+1, parentId=old.id
 *
 * This preserves the full history: v1 (no context) → v2 (with context + corrections) → etc.
 */
async function saveMappings(
  resolved: ReturnType<typeof resolveTransferMappings>,
  workspaceId: string,
  transferId: string,
  model: string | null,
): Promise<number> {
  let created = 0;
  let retired = 0;

  for (const r of resolved) {
    if (!r.targetFieldId) continue; // skip unresolved

    // Check for existing mapping (same target field + transfer)
    const [existing] = await db
      .select({ id: fieldMapping.id, version: fieldMapping.version })
      .from(fieldMapping)
      .where(
        and(
          eq(fieldMapping.targetFieldId, r.targetFieldId),
          eq(fieldMapping.transferId, transferId),
          eq(fieldMapping.isLatest, true),
        )
      )
      .limit(1);

    if (existing) {
      // Retire old version (preserves verdicts, notes, feedback)
      await db
        .update(fieldMapping)
        .set({ isLatest: false })
        .where(eq(fieldMapping.id, existing.id));
      retired++;
    }

    await db.insert(fieldMapping).values({
      workspaceId,
      targetFieldId: r.targetFieldId,
      transferId,
      status: r.hasMapping ? "unreviewed" : "unmapped",
      mappingType: r.defaultValue ? "derived" : r.mappingType,
      sourceFieldId: r.sourceFieldId,
      transform: r.transformation || null,
      defaultValue: r.defaultValue || null,
      reasoning: r.reasoning,
      confidence: r.confidence,
      notes: null,
      createdBy: r.corrected ? "import" : "llm",
      isLatest: true,
      version: existing ? existing.version + 1 : 1,
      parentId: existing?.id || null,
    });
    created++;
  }

  if (retired > 0) {
    console.log(`    Retired ${retired} prior mappings (preserved with verdicts)`);
  }
  return created;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
