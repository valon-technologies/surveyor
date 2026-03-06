import { db } from "../src/lib/db";
import { field, fieldMapping, entity } from "../src/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";

async function main() {
  const m25Fields = await db
    .select({ fieldId: field.id, fieldName: field.name, entityId: field.entityId })
    .from(field)
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(and(eq(entity.side, "target"), eq(field.milestone, "M2.5")));

  const existingMappings = await db
    .select({ targetFieldId: fieldMapping.targetFieldId })
    .from(fieldMapping)
    .where(and(eq(fieldMapping.isLatest, true), isNull(fieldMapping.transferId)));

  const mappedIds = new Set(existingMappings.map(m => m.targetFieldId));
  const missing = m25Fields.filter(f => mappedIds.has(f.fieldId) === false);

  const byEntity: Record<string, string[]> = {};
  for (const f of missing) {
    if (byEntity[f.entityId] === undefined) byEntity[f.entityId] = [];
    byEntity[f.entityId].push(f.fieldName);
  }

  const entities = await db.select({ id: entity.id, name: entity.name }).from(entity).where(eq(entity.side, "target"));
  const nameById = new Map(entities.map(e => [e.id, e.name]));

  console.log("M2.5 fields missing mappings: " + missing.length);
  console.log("Across " + Object.keys(byEntity).length + " entities:\n");

  const sorted = Object.entries(byEntity).sort((a, b) => b[1].length - a[1].length);
  for (const [eId, fields] of sorted) {
    console.log("  " + (nameById.get(eId) || eId) + ": " + fields.length + " fields");
  }

  // Cost estimate: ~200 tokens input overhead per field + ~150 output
  const totalFields = missing.length;
  const estInputTokens = totalFields * 500; // field desc + context per field
  const estOutputTokens = totalFields * 150;
  const cost = (estInputTokens / 1e6) * 15 + (estOutputTokens / 1e6) * 75;
  console.log("\nCost estimate (Opus): ~$" + cost.toFixed(2));
  console.log("Runtime estimate: ~" + Math.ceil(totalFields * 2.75 / 60) + " minutes");

  process.exit(0);
}
main();
