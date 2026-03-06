import { db } from "../src/lib/db";
import { field, fieldMapping, entity } from "../src/lib/db/schema";
import { eq, and, isNull, count } from "drizzle-orm";

async function main() {
  const milestones = await db
    .select({ milestone: field.milestone, cnt: count() })
    .from(field)
    .innerJoin(entity, eq(field.entityId, entity.id))
    .where(eq(entity.side, "target"))
    .groupBy(field.milestone);

  console.log("Target fields by milestone:");
  for (const m of milestones) {
    console.log("  " + (m.milestone || "(null)") + ": " + m.cnt);
  }

  const mappings = await db
    .select({ milestone: field.milestone, status: fieldMapping.status, cnt: count() })
    .from(fieldMapping)
    .innerJoin(field, eq(fieldMapping.targetFieldId, field.id))
    .where(and(eq(fieldMapping.isLatest, true), isNull(fieldMapping.transferId)))
    .groupBy(field.milestone, fieldMapping.status);

  console.log("\nVDS Review mappings by milestone + status:");
  const byMs: Record<string, Record<string, number>> = {};
  for (const m of mappings) {
    const ms = m.milestone || "(null)";
    if (!byMs[ms]) byMs[ms] = {};
    byMs[ms][m.status] = m.cnt;
  }
  for (const ms of Object.keys(byMs).sort()) {
    const statuses = byMs[ms];
    const parts = Object.entries(statuses).map(([s, c]) => s + ":" + c).join(", ");
    const total = Object.values(statuses).reduce((a, b) => a + b, 0);
    console.log("  " + ms + " (" + total + "): " + parts);
  }

  process.exit(0);
}
main();
