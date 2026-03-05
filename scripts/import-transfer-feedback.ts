#!/usr/bin/env npx tsx
/**
 * Import transfer feedback from the reviewed Excel workbook.
 *
 * Reads vds-stockton-coverage_2026-02-25_1252.xlsx (or a specified file),
 * classifies each row's feedback, and creates:
 * - transfer_correction records (hard_override / prompt_injection)
 * - field_mapping verdict updates (sourceVerdict / transformVerdict)
 *
 * Usage:
 *   npx tsx scripts/import-transfer-feedback.ts --transfer-id <uuid> [--file <path>] [--dry-run]
 */

import * as XLSX from "xlsx";
import { db } from "../src/lib/db";
import {
  transfer,
  transferCorrection,
  fieldMapping,
  field,
  entity,
} from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";

// ─── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const transferId = getArg("--transfer-id") || getArg("-t");
const filePath =
  getArg("--file") ||
  getArg("-f") ||
  "data/transfers/stockton/feedback.xlsx";
const dryRun = args.includes("--dry-run");

if (!transferId) {
  console.error("Usage: npx tsx scripts/import-transfer-feedback.ts --transfer-id <uuid> [--file <path>] [--dry-run]");
  process.exit(1);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

// ─── Types ────────────────────────────────────────────────
interface FeedbackRow {
  domain: string;
  vdsEntity: string;
  vdsField: string;
  type: string;
  schemaReq: string;
  onboardingReq: string;
  onboardingCondition: string;
  hasMapping: boolean;
  fieldCorrectness: string;
  fieldNotes: string;
  stocktonField: string;
  stocktonPos: number;
  sampleValue: string;
  transformation: string;
  transformCorrectness: string;
  transformNotes: string;
  confidence: string;
  reasoning: string;
  contextUsed: string;
  followUpQuestion: string;
  generalNotes: string;
}

type CorrectionType = "hard_override" | "prompt_injection";

interface ClassifiedFeedback {
  row: FeedbackRow;
  action: "correct" | "hard_override" | "prompt_injection" | "skip";
  reason: string;
}

// ─── Parse Excel ──────────────────────────────────────────
function parseExcel(path: string): FeedbackRow[] {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets["Field Mapping"];
  if (!ws) throw new Error("Sheet 'Field Mapping' not found");

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  return raw.map((r) => ({
    domain: String(r["Domain"] ?? ""),
    vdsEntity: String(r["VDS Entity"] ?? ""),
    vdsField: String(r["VDS Field"] ?? ""),
    type: String(r["Type"] ?? ""),
    schemaReq: String(r["Schema Req"] ?? ""),
    onboardingReq: String(r["Onboarding Req"] ?? ""),
    onboardingCondition: String(r["Onboarding Condition"] ?? ""),
    hasMapping: String(r["Has Mapping"] ?? "").toLowerCase() === "yes",
    fieldCorrectness: String(r["Field Correctness"] ?? ""),
    fieldNotes: String(r["Field Notes"] ?? ""),
    stocktonField: String(r["Stockton Field"] ?? ""),
    stocktonPos: Number(r["Stockton Pos"] ?? -1),
    sampleValue: String(r["Sample Value"] ?? ""),
    transformation: String(r["Transformation"] ?? ""),
    transformCorrectness: String(r["Transformation Correctness"] ?? ""),
    transformNotes: String(r["Transformation Notes"] ?? ""),
    confidence: String(r["Confidence"] ?? ""),
    reasoning: String(r["Reasoning"] ?? ""),
    contextUsed: String(r["Context Used"] ?? ""),
    followUpQuestion: String(r["Follow-Up Question"] ?? ""),
    generalNotes: String(r["General Notes"] ?? ""),
  }));
}

// ─── Classify feedback rows ───────────────────────────────
function classify(row: FeedbackRow): ClassifiedFeedback {
  const fc = row.fieldCorrectness;
  const tc = row.transformCorrectness;
  const notes = row.fieldNotes || row.transformNotes || row.generalNotes;

  // Both correct, no notes → confirmed correct
  if (fc === "Correct" && tc === "Correct" && !row.fieldNotes && !row.transformNotes && !row.generalNotes) {
    return { row, action: "correct", reason: "Both verdicts correct" };
  }

  // Incorrect with specific mapping guidance → hard override
  if (fc === "Incorrect" && notes) {
    // Check for patterns indicating deferred/token-dependent feedback
    const lower = notes.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("determine with") ||
      lower.includes("can't easily be mapped") ||
      lower.includes("leave it blank") ||
      lower.includes("don't actually think we can map")
    ) {
      return { row, action: "prompt_injection", reason: "Deferred/token-dependent correction" };
    }
    // Check for patterns indicating the reviewer specified a concrete mapping
    if (
      lower.includes("set to") ||
      lower.includes("set this") ||
      lower.includes("should be") ||
      lower.includes("map from") ||
      lower.includes("should be mapped") ||
      lower.includes("equal to") ||
      lower.includes("the field") ||
      lower.includes("the system should")
    ) {
      return { row, action: "hard_override", reason: "Reviewer specified concrete mapping" };
    }
    // Default: treat as prompt injection (guidance for LLM)
    return { row, action: "prompt_injection", reason: "Incorrect with guidance notes" };
  }

  // Partial → always prompt injection (guidance)
  if (fc === "Partial" || tc === "Partial") {
    if (!notes) return { row, action: "skip", reason: "Partial without notes" };
    return { row, action: "prompt_injection", reason: "Partial feedback with guidance" };
  }

  // Transform-only incorrect
  if (tc === "Incorrect" && (row.transformNotes || row.generalNotes)) {
    return { row, action: "prompt_injection", reason: "Transform incorrect with notes" };
  }

  // Has notes but correct verdicts
  if (notes && (fc === "Correct" || !fc) && (tc === "Correct" || !tc)) {
    return { row, action: "prompt_injection", reason: "Correct with additional notes" };
  }

  return { row, action: "skip", reason: "No actionable feedback" };
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  console.log(`Reading feedback from: ${filePath}`);
  console.log(`Transfer ID: ${transferId}`);
  if (dryRun) console.log("DRY RUN — no DB writes");

  // Verify transfer exists
  const [t] = await db
    .select({ id: transfer.id, workspaceId: transfer.workspaceId })
    .from(transfer)
    .where(eq(transfer.id, transferId!));

  if (!t) {
    console.error(`Transfer ${transferId} not found`);
    process.exit(1);
  }

  // Parse Excel
  const rows = parseExcel(filePath);
  console.log(`Parsed ${rows.length} rows from Excel`);

  // Classify all rows
  const classified = rows.map(classify);

  // Summary
  const counts = { correct: 0, hard_override: 0, prompt_injection: 0, skip: 0 };
  for (const c of classified) {
    counts[c.action]++;
  }
  console.log(`\nClassification summary:`);
  console.log(`  Confirmed correct: ${counts.correct}`);
  console.log(`  Hard overrides:    ${counts.hard_override}`);
  console.log(`  Prompt injections: ${counts.prompt_injection}`);
  console.log(`  Skipped:           ${counts.skip}`);

  if (dryRun) {
    console.log("\nDry run — showing first 10 corrections:");
    const corrections = classified.filter((c) => c.action === "hard_override" || c.action === "prompt_injection");
    for (const c of corrections.slice(0, 10)) {
      const notes = c.row.fieldNotes || c.row.transformNotes || c.row.generalNotes;
      console.log(`  [${c.action}] ${c.row.vdsEntity}.${c.row.vdsField}: ${notes.slice(0, 100)}...`);
    }
    process.exit(0);
  }

  // Get userId for createdBy (use first workspace member)
  const { user: userTable, userWorkspace } = await import("../src/lib/db/schema");
  const [member] = await db
    .select({ userId: userWorkspace.userId })
    .from(userWorkspace)
    .where(eq(userWorkspace.workspaceId, t.workspaceId))
    .limit(1);
  const userId = member?.userId || "system";

  // Check for existing corrections to avoid duplicates
  const existing = await db
    .select({
      targetEntity: transferCorrection.targetEntity,
      targetField: transferCorrection.targetField,
    })
    .from(transferCorrection)
    .where(eq(transferCorrection.transferId, transferId!));

  const existingKeys = new Set(existing.map((e) => `${e.targetEntity}.${e.targetField}`));

  // Import corrections
  let created = 0;
  let skippedDups = 0;

  for (const c of classified) {
    if (c.action === "correct" || c.action === "skip") continue;

    const key = `${c.row.vdsEntity}.${c.row.vdsField}`;
    if (existingKeys.has(key)) {
      skippedDups++;
      continue;
    }

    const notes = c.row.fieldNotes || c.row.transformNotes || c.row.generalNotes;

    if (c.action === "hard_override") {
      await db.insert(transferCorrection).values({
        transferId: transferId!,
        workspaceId: t.workspaceId,
        type: "hard_override",
        targetEntity: c.row.vdsEntity,
        targetField: c.row.vdsField,
        hasMapping: c.row.hasMapping || notes.toLowerCase().includes("set to") || notes.toLowerCase().includes("should be"),
        sourceFieldName: c.row.stocktonField || null,
        sourceFieldPosition: c.row.stocktonPos >= 0 ? c.row.stocktonPos : null,
        transformation: c.row.transformation || null,
        confidence: c.row.confidence || "MEDIUM",
        reasoning: notes,
        note: notes,
        createdBy: userId,
      });
    } else {
      // prompt_injection
      await db.insert(transferCorrection).values({
        transferId: transferId!,
        workspaceId: t.workspaceId,
        type: "prompt_injection",
        targetEntity: c.row.vdsEntity,
        targetField: c.row.vdsField || null,
        appliesTo: [key],
        note: notes,
        createdBy: userId,
      });
    }

    existingKeys.add(key);
    created++;
  }

  console.log(`\nImported ${created} corrections (${skippedDups} skipped as duplicates)`);

  // Update field_mapping verdicts for confirmed-correct rows
  // Look up target field IDs and match to existing transfer mappings
  let verdictsUpdated = 0;
  const correctRows = classified.filter((c) => c.action === "correct");

  if (correctRows.length > 0) {
    // Get all transfer mappings
    const transferMappings = await db
      .select({
        mappingId: fieldMapping.id,
        fieldName: field.name,
        entityName: entity.name,
      })
      .from(fieldMapping)
      .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
      .innerJoin(entity, eq(field.entityId, entity.id))
      .where(
        and(
          eq(fieldMapping.transferId, transferId!),
          eq(fieldMapping.isLatest, true),
        )
      );

    const mappingByKey = new Map(
      transferMappings.map((m) => [`${m.entityName}.${m.fieldName}`, m.mappingId])
    );

    for (const c of correctRows) {
      const key = `${c.row.vdsEntity}.${c.row.vdsField}`;
      const mappingId = mappingByKey.get(key);
      if (mappingId) {
        await db
          .update(fieldMapping)
          .set({
            sourceVerdict: "correct",
            transformVerdict: "correct",
          })
          .where(eq(fieldMapping.id, mappingId));
        verdictsUpdated++;
      }
    }
  }

  console.log(`Updated ${verdictsUpdated} mapping verdicts to 'correct'`);
  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
