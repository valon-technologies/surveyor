#!/usr/bin/env npx tsx
import { db } from "../src/lib/db";
import { transfer, field, entity } from "../src/lib/db/schema";
import { eq, count } from "drizzle-orm";

async function main() {
  const transfers = await db.select().from(transfer);
  console.log(`Transfers (${transfers.length}):`);
  for (const t of transfers) {
    // Count source fields
    if (t.sourceSchemaAssetId) {
      const srcEntities = await db.select({ id: entity.id }).from(entity)
        .where(eq(entity.schemaAssetId, t.sourceSchemaAssetId));
      let fieldCount = 0;
      for (const e of srcEntities) {
        const [c] = await db.select({ count: count() }).from(field).where(eq(field.entityId, e.id));
        fieldCount += c?.count ?? 0;
      }
      console.log(`  ${t.name} | ${t.id} | status=${t.status} | ${fieldCount} source fields`);
    } else {
      console.log(`  ${t.name} | ${t.id} | status=${t.status} | no source schema`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
