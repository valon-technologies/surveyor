/**
 * Anchor harvested claims against SOT YAML mappings and score confidence.
 *
 * Usage:
 *   npx tsx scripts/harvest/anchor-claims.ts [--dry-run]
 */

import { readFileSync } from "fs";

// Load .env.local before any other imports that read env vars
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

import Anthropic from "@anthropic-ai/sdk";
import { loadAllClaims, saveClaims } from "./lib/store";
import { loadSotMappings, findSotMapping } from "./lib/sot-loader";
import type { HarvestedClaim, SotMapping } from "./lib/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4-20250514";
const RATE_LIMIT_MS = 300;
const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// LLM anchor comparison
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are comparing a claim about a data field mapping against the SOT (Source of Truth) YAML mapping. Determine whether the claim:
- **agrees**: Same source, transform, or logic as the SOT mapping
- **contradicts**: Conflicts with the SOT mapping (different source, wrong transform, incorrect logic)
- **related**: About the field but the SOT cannot confirm or deny the claim

Return ONLY a JSON object with this exact shape (no markdown fences):
{ "status": "agrees" | "contradicts" | "related", "detail": "brief explanation" }`;

function buildUserMessage(claim: HarvestedClaim, sot: SotMapping): string {
  const sourceTables = sot.sources
    .map((s) => `${s.name} (alias: ${s.alias}, staging: ${s.staging})`)
    .join("; ");

  return `**Claim** (${claim.claimType}):
${claim.claimText}

**SOT Mapping** for ${sot.entity}.${sot.field}:
- Source column: ${sot.sourceColumn ?? "(none)"}
- Transform: ${sot.transform}
- Data type: ${sot.dtype}
- Source tables: ${sourceTables || "(none)"}`;
}

async function anchorWithLlm(
  client: Anthropic,
  claim: HarvestedClaim,
  sot: SotMapping,
): Promise<{ status: "agrees" | "contradicts" | "related"; detail: string }> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(claim, sot) }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
    const status = parsed.status;
    if (status === "agrees" || status === "contradicts" || status === "related") {
      return { status, detail: parsed.detail ?? "" };
    }
  } catch {
    // fall through
  }

  console.warn(`  Warning: could not parse LLM response, defaulting to "related"`);
  return { status: "related", detail: `Unparseable LLM response: ${text.slice(0, 120)}` };
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

function computeConfidence(claim: HarvestedClaim): number {
  const BASE: Record<string, number> = {
    agrees: 0.9,
    related: 0.6,
    unanchored: 0.4,
    contradicts: 0.1,
  };

  let score = BASE[claim.anchorStatus] ?? 0.4;

  if (claim.source === "google_sheet") score += 0.1;
  if (claim.source === "linear") score += 0.05;

  return Math.min(1.0, Math.round(score * 100) / 100);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const allClaims = loadAllClaims();
  console.log(`Loaded ${allClaims.length} total claims`);

  // Load SOT mappings for both milestones
  const m1Sot = loadSotMappings("M1");
  const m2Sot = loadSotMappings("M2");

  // Partition claims
  const noEntityField: HarvestedClaim[] = [];
  const needsAnchoring: HarvestedClaim[] = [];
  const noSotMapping: HarvestedClaim[] = [];
  const toAnchor: { claim: HarvestedClaim; sot: SotMapping }[] = [];

  for (const claim of allClaims) {
    if (!claim.entityName || !claim.fieldName) {
      noEntityField.push(claim);
      continue;
    }

    const sotMap = claim.milestone === "M1" ? m1Sot : m2Sot;
    const sot = findSotMapping(sotMap, claim.entityName, claim.fieldName);

    if (!sot) {
      noSotMapping.push(claim);
    } else {
      toAnchor.push({ claim, sot });
    }
  }

  console.log(`\nPartition:`);
  console.log(`  No entity+field:  ${noEntityField.length}`);
  console.log(`  No SOT mapping:   ${noSotMapping.length}`);
  console.log(`  Need LLM anchor:  ${toAnchor.length}`);

  if (DRY_RUN) {
    console.log(`\n--dry-run: would call LLM for ${toAnchor.length} claims. Exiting.`);
    return;
  }

  // Mark claims that can't be anchored
  for (const claim of noEntityField) {
    claim.anchorStatus = "unanchored";
    claim.anchorDetail = "No entity+field resolved";
    claim.confidence = computeConfidence(claim);
  }

  for (const claim of noSotMapping) {
    claim.anchorStatus = "unanchored";
    claim.anchorDetail = `No SOT mapping for ${claim.entityName}.${claim.fieldName}`;
    claim.confidence = computeConfidence(claim);
  }

  // Anchor claims via LLM
  const client = new Anthropic();
  let processed = 0;

  for (const { claim, sot } of toAnchor) {
    processed++;
    if (processed % 20 === 0 || processed === toAnchor.length) {
      console.log(`  Anchoring ${processed}/${toAnchor.length}...`);
    }

    try {
      const result = await anchorWithLlm(client, claim, sot);
      claim.anchorStatus = result.status;
      claim.anchorDetail = result.detail;
    } catch (err) {
      console.warn(`  Error anchoring claim ${claim.id}: ${(err as Error).message}`);
      claim.anchorStatus = "related";
      claim.anchorDetail = `LLM error: ${(err as Error).message}`;
    }

    claim.confidence = computeConfidence(claim);

    // Rate limit
    if (processed < toAnchor.length) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  // Combine all claims
  const allProcessed = [...noEntityField, ...noSotMapping, ...toAnchor.map((t) => t.claim)];

  // Partition results
  const surviving = allProcessed.filter(
    (c) => c.anchorStatus !== "contradicts" && c.confidence >= 0.4,
  );
  const contradictions = allProcessed.filter((c) => c.anchorStatus === "contradicts");

  // Save
  saveClaims("anchored-claims.json", surviving);
  saveClaims("contradictions-report.json", contradictions);

  // Summary
  const counts: Record<string, number> = {};
  for (const c of allProcessed) {
    counts[c.anchorStatus] = (counts[c.anchorStatus] ?? 0) + 1;
  }

  console.log(`\n--- Anchor Summary ---`);
  for (const [status, count] of Object.entries(counts).sort()) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`  Total surviving: ${surviving.length}`);
  console.log(`  Total contradictions: ${contradictions.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
