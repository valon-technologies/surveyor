/**
 * Convert prompt injections that the LLM ignored into hard overrides.
 * Extracts default values and source field references from the note text.
 *
 * Usage: npx tsx scripts/convert-ignored-to-overrides.ts [--dry-run]
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const { db } = await import("../src/lib/db");
  const { fieldMapping, field, entity, transferCorrection } = await import("../src/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");

  const tid = "c5721607-bef7-41be-97dd-77170422d8cf";

  // Load all prompt injections
  const corrections = await db.select().from(transferCorrection)
    .where(and(eq(transferCorrection.transferId, tid), eq(transferCorrection.type, "prompt_injection")));

  // Load latest transfer mappings
  const mappings = await db
    .select({ targetFieldId: fieldMapping.targetFieldId, status: fieldMapping.status })
    .from(fieldMapping)
    .where(and(eq(fieldMapping.transferId, tid), eq(fieldMapping.isLatest, true)));

  // Build key lookup
  const targetFields = await db.select({ id: field.id, name: field.name, entityId: field.entityId }).from(field);
  const entities = await db.select({ id: entity.id, name: entity.name }).from(entity);
  const entName = new Map(entities.map(e => [e.id, e.name]));
  const fieldKey = new Map(targetFields.map(f => [f.id, entName.get(f.entityId) + "." + f.name]));
  const mappingByKey = new Map(mappings.map(m => [fieldKey.get(m.targetFieldId), m.status]));

  // Find ignored corrections (says to map, but still unmapped)
  const mapPhrases = [
    "should", "set to", "set this", "map to", "map from", "use the",
    "use is", "equal to", "can be derived", "field to use", "default",
    "hard-coded", "0.00", "false", "true", "boarding",
  ];

  let converted = 0;
  let skipped = 0;

  for (const c of corrections) {
    const key = c.targetEntity + "." + (c.targetField || "");
    const note = (c.note || "").toLowerCase();

    const saysMap = mapPhrases.some(p => note.includes(p));
    if (saysMap === false) { skipped++; continue; }

    const status = mappingByKey.get(key);
    if (status !== undefined && status !== "unmapped") { skipped++; continue; }

    // Extract default value / transformation from note
    const transformation = extractTransformation(c.note || "");

    if (DRY_RUN) {
      console.log(`  [convert] ${key}`);
      console.log(`    transform: ${transformation}`);
      console.log(`    note: ${(c.note || "").slice(0, 80)}`);
      converted++;
      continue;
    }

    // Convert to hard override
    await db.update(transferCorrection).set({
      type: "hard_override",
      hasMapping: true,
      transformation,
      confidence: "HIGH",
    }).where(eq(transferCorrection.id, c.id));
    converted++;
  }

  console.log(`Converted: ${converted}`);
  console.log(`Skipped (already mapped or no map phrase): ${skipped}`);
  if (DRY_RUN) console.log("(dry run — no DB changes)");

  process.exit(0);
}

/**
 * Extract a transformation/default value from correction note text.
 */
function extractTransformation(note: string): string {
  const lower = note.toLowerCase();

  // "hard-coded as 0.00" / "set to 0.00" / "equal to 0.00"
  if (lower.includes("0.00") || lower.includes("zero")) {
    return "literal: 0.00";
  }

  // Boolean defaults
  if (lower.includes("set to true") || lower.includes("set this to true") || lower.includes("default map to true")) {
    return "literal: true";
  }
  if (lower.includes("set to false") || lower.includes("set this to false") || lower.includes("default map to false")) {
    return "literal: false";
  }

  // Specific string constants
  const stringPatterns = [
    { pattern: /set (?:this )?(?:value )?(?:to|as|equal to) "([^"]+)"/i, group: 1 },
    { pattern: /should be "([^"]+)"/i, group: 1 },
    { pattern: /set (?:this )?(?:value )?(?:to|as) '([^']+)'/i, group: 1 },
  ];
  for (const { pattern, group } of stringPatterns) {
    const match = note.match(pattern);
    if (match) return `literal: ${match[group]}`;
  }

  // "set to 1" / "version should be 1"
  if (/set (?:this )?to (\d+)\b/i.test(note)) {
    const match = note.match(/set (?:this )?to (\d+)\b/i);
    if (match) return `literal: ${match[1]}`;
  }

  // Source field reference: "use the field X" / "map from X" / "equal to the X field"
  // These need the source field name, not a literal — keep as expression
  if (lower.includes("use the") || lower.includes("map from") || lower.includes("equal to the")) {
    return `expression: ${note.slice(0, 200)}`;
  }

  // Derived / conditional logic
  if (lower.includes("derive") || lower.includes("if the") || lower.includes("check")) {
    return `expression: ${note.slice(0, 200)}`;
  }

  // Fallback: store the full note as the transformation description
  return `expression: ${note.slice(0, 200)}`;
}

main().catch((err) => { console.error(err); process.exit(1); });
