/**
 * Export servicing transfer mappings to XLSX for offline review.
 * One row per field, pre-populated with AI-generated mapping + review.
 *
 * Usage: npx tsx --env-file=.env.local scripts/export-transfer-review-sheet.ts --transfer <id> [--output <path>]
 */
import { db } from "../src/lib/db";
import { fieldMapping, field, entity, transfer } from "../src/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import * as XLSX from "xlsx";

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const transferId = getArg("--transfer") || getArg("-t");
const outputPath = getArg("--output") || getArg("-o");

async function main() {
  // If no transfer ID, list available transfers
  if (!transferId) {
    const transfers = await db.select({ id: transfer.id, name: transfer.name, clientName: transfer.clientName })
      .from(transfer);
    console.log("Available transfers:");
    for (const t of transfers) {
      console.log(`  ${t.id}  ${t.name} (${t.clientName || "no client"})`);
    }
    console.error("\nUsage: npx tsx --env-file=.env.local scripts/export-transfer-review-sheet.ts --transfer <id>");
    process.exit(1);
  }

  // Load transfer
  const [t] = await db.select().from(transfer).where(eq(transfer.id, transferId));
  if (!t) { console.error(`Transfer ${transferId} not found`); process.exit(1); }
  console.log(`Transfer: ${t.name} (${t.clientName || "no client"})`);

  // Load all latest mappings for this transfer
  const mappings = await db
    .select({
      id: fieldMapping.id,
      status: fieldMapping.status,
      mappingType: fieldMapping.mappingType,
      sourceFieldId: fieldMapping.sourceFieldId,
      sourceEntityId: fieldMapping.sourceEntityId,
      transform: fieldMapping.transform,
      defaultValue: fieldMapping.defaultValue,
      enumMapping: fieldMapping.enumMapping,
      reasoning: fieldMapping.reasoning,
      confidence: fieldMapping.confidence,
      notes: fieldMapping.notes,
      aiReview: fieldMapping.aiReview,
      targetFieldId: fieldMapping.targetFieldId,
    })
    .from(fieldMapping)
    .where(and(eq(fieldMapping.transferId, transferId), eq(fieldMapping.isLatest, true)));

  console.log(`Mappings: ${mappings.length}`);

  // Build lookups
  const fieldById = new Map<string, { name: string; dataType: string | null; description: string | null; entityId: string }>();
  const entityById = new Map<string, { name: string }>();

  const allFields = await db.select({ id: field.id, name: field.name, dataType: field.dataType, description: field.description, entityId: field.entityId }).from(field);
  for (const f of allFields) fieldById.set(f.id, f);

  const allEntities = await db.select({ id: entity.id, name: entity.name }).from(entity);
  for (const e of allEntities) entityById.set(e.id, e);

  // Build rows
  const rows: Record<string, string | null>[] = [];

  for (const m of mappings) {
    const targetField = fieldById.get(m.targetFieldId);
    const targetEntity = targetField ? entityById.get(targetField.entityId) : null;
    const sourceField = m.sourceFieldId ? fieldById.get(m.sourceFieldId) : null;
    const sourceEntity = m.sourceEntityId ? entityById.get(m.sourceEntityId) : null;

    const aiReview = m.aiReview as { reviewText?: string; proposedUpdate?: Record<string, unknown> } | null;

    rows.push({
      // Context (read-only for reviewer)
      "mapping_id": m.id,
      "target_entity": targetEntity?.name || "",
      "target_field": targetField?.name || "",
      "data_type": targetField?.dataType || "",
      "field_description": targetField?.description || "",
      "ai_status": m.status || "",
      "ai_mapping_type": m.mappingType || "",
      "ai_source_entity": sourceEntity?.name || "",
      "ai_source_field": sourceField?.name || "",
      "ai_transform": m.transform || "",
      "ai_default_value": m.defaultValue || "",
      "ai_confidence": m.confidence || "",
      "ai_reasoning": m.reasoning || "",
      "ai_review_summary": aiReview?.reviewText?.slice(0, 500) || "",

      // Reviewer fills these in
      "source_verdict": "",           // correct / wrong
      "source_correction": "",        // if wrong: correct source field name
      "transform_verdict": "",        // correct / wrong
      "transform_correction": "",     // if wrong: correct transform expression
      "reviewer_confidence": "",      // high / medium / low
      "status_decision": "",          // accepted / excluded / needs_discussion / punted
      "exclude_reason": "",           // if excluding: why
      "question_for_client": "",      // structured question for the client
      "notes": m.notes || "",         // reviewer notes (pre-populated if any exist)
      "reviewer_name": "",            // who reviewed
    });
  }

  // Sort by entity, then field
  rows.sort((a, b) => {
    const ec = (a.target_entity || "").localeCompare(b.target_entity || "");
    if (ec !== 0) return ec;
    return (a.target_field || "").localeCompare(b.target_field || "");
  });

  // Build XLSX
  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 36 },  // mapping_id
    { wch: 30 },  // target_entity
    { wch: 30 },  // target_field
    { wch: 12 },  // data_type
    { wch: 50 },  // field_description
    { wch: 14 },  // ai_status
    { wch: 14 },  // ai_mapping_type
    { wch: 25 },  // ai_source_entity
    { wch: 25 },  // ai_source_field
    { wch: 40 },  // ai_transform
    { wch: 20 },  // ai_default_value
    { wch: 10 },  // ai_confidence
    { wch: 50 },  // ai_reasoning
    { wch: 50 },  // ai_review_summary
    { wch: 14 },  // source_verdict
    { wch: 30 },  // source_correction
    { wch: 14 },  // transform_verdict
    { wch: 40 },  // transform_correction
    { wch: 14 },  // reviewer_confidence
    { wch: 18 },  // status_decision
    { wch: 30 },  // exclude_reason
    { wch: 50 },  // question_for_client
    { wch: 40 },  // notes
    { wch: 20 },  // reviewer_name
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transfer Review");

  // Add instructions sheet
  const instructions = [
    { "Instructions": "SERVICING TRANSFER REVIEW SHEET" },
    { "Instructions": "" },
    { "Instructions": "Columns A-N are pre-populated from Surveyor AI. DO NOT EDIT these columns." },
    { "Instructions": "" },
    { "Instructions": "Fill in columns O-X (highlighted) for each field:" },
    { "Instructions": "" },
    { "Instructions": "source_verdict: 'correct' if AI source is right, 'wrong' if not" },
    { "Instructions": "source_correction: If wrong, enter the correct source field name from the flat file" },
    { "Instructions": "transform_verdict: 'correct' if AI transform is right, 'wrong' if not" },
    { "Instructions": "transform_correction: If wrong, enter the correct transformation logic" },
    { "Instructions": "reviewer_confidence: 'high', 'medium', or 'low'" },
    { "Instructions": "status_decision: 'accepted' (mapping is correct), 'excluded' (not needed for transfer), 'needs_discussion' (needs team discussion), 'punted' (pass to another reviewer)" },
    { "Instructions": "exclude_reason: Required if status_decision = 'excluded'" },
    { "Instructions": "question_for_client: A question to ask the client about this field's mapping" },
    { "Instructions": "notes: Any additional context or observations" },
    { "Instructions": "reviewer_name: Your name" },
    { "Instructions": "" },
    { "Instructions": `Transfer: ${t.name} (${t.clientName || ""})` },
    { "Instructions": `Exported: ${new Date().toISOString()}` },
    { "Instructions": `Total fields: ${rows.length}` },
  ];
  const instrWs = XLSX.utils.json_to_sheet(instructions);
  instrWs["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

  const outFile = outputPath || `transfer-review-${t.name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, outFile);
  console.log(`\nExported ${rows.length} rows to ${outFile}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
