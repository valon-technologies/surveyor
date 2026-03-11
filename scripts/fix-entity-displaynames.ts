#!/usr/bin/env npx tsx
/**
 * Fix entity displayName where it was incorrectly set to the description.
 * Sets displayName = name for all child entities where they differ.
 */
import { db } from "../src/lib/db";
import { entity } from "../src/lib/db/schema";
import { isNotNull, and, eq } from "drizzle-orm";

async function main() {
  const ents = await db
    .select({ id: entity.id, name: entity.name, displayName: entity.displayName })
    .from(entity)
    .where(and(isNotNull(entity.parentEntityId), isNotNull(entity.displayName)));

  let bad = 0;
  for (const e of ents) {
    if (e.displayName && e.displayName !== e.name) {
      console.log(`  ${e.name} -> was "${e.displayName.substring(0, 80)}"`);
      await db.update(entity).set({ displayName: e.name }).where(eq(entity.id, e.id));
      bad++;
    }
  }

  console.log(`\nFixed ${bad} of ${ents.length} child entities.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
