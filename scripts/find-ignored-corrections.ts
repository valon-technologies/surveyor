import { db } from "../src/lib/db";
import { fieldMapping, field, entity, transferCorrection } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const tid = "c5721607-bef7-41be-97dd-77170422d8cf";

  const corrections = await db.select().from(transferCorrection)
    .where(and(eq(transferCorrection.transferId, tid), eq(transferCorrection.type, "prompt_injection")));

  const mappings = await db
    .select({ targetFieldId: fieldMapping.targetFieldId, status: fieldMapping.status, sourceFieldId: fieldMapping.sourceFieldId })
    .from(fieldMapping)
    .where(and(eq(fieldMapping.transferId, tid), eq(fieldMapping.isLatest, true)));

  const targetFields = await db.select({ id: field.id, name: field.name, entityId: field.entityId }).from(field);
  const entities = await db.select({ id: entity.id, name: entity.name }).from(entity);
  const entName = new Map(entities.map(e => [e.id, e.name]));
  const fieldKey = new Map(targetFields.map(f => [f.id, entName.get(f.entityId) + "." + f.name]));

  const mappingByKey = new Map<string, { status: string; hasSource: boolean }>();
  for (const m of mappings) {
    const key = fieldKey.get(m.targetFieldId);
    if (key) mappingByKey.set(key, { status: m.status, hasSource: m.sourceFieldId != null });
  }

  const mapPhrases = [
    "should", "set to", "set this", "map to", "map from", "use the",
    "use is", "equal to", "can be derived", "field to use", "default",
    "hard-coded", "0.00", "false", "true", "boarding",
  ];

  const ignored: Array<{ key: string; note: string }> = [];
  for (const c of corrections) {
    const key = c.targetEntity + "." + (c.targetField || "");
    const note = (c.note || "").toLowerCase();

    const saysMap = mapPhrases.some(p => note.includes(p));
    if (saysMap === false) continue;

    const mapping = mappingByKey.get(key);
    if (mapping === undefined || mapping.status === "unmapped") {
      ignored.push({ key, note: (c.note || "").slice(0, 120) });
    }
  }

  console.log("Corrections saying to map, but field is still unmapped: " + ignored.length);
  console.log("");
  for (const item of ignored) {
    console.log("  " + item.key);
    console.log("    " + item.note);
    console.log("");
  }
  process.exit(0);
}
main();
