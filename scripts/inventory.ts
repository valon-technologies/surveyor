#!/usr/bin/env npx tsx --env-file=.env.local
/**
 * Show mapping inventory by milestone.
 * Usage: npx tsx --env-file=.env.local scripts/inventory.ts
 */
import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db.execute(sql`
    SELECT
      COALESCE(f.milestone, 'none') as milestone,
      COUNT(DISTINCT f.id) as total_fields,
      COUNT(DISTINCT CASE WHEN fm.id IS NOT NULL THEN f.id END) as has_mapping,
      COUNT(DISTINCT CASE WHEN fm.id IS NOT NULL AND fm.status != 'unmapped' AND fm.source_field_id IS NOT NULL THEN f.id END) as has_source,
      COUNT(DISTINCT CASE WHEN fm.ai_review IS NOT NULL THEN f.id END) as has_review,
      COUNT(DISTINCT CASE WHEN fm.status = 'accepted' THEN f.id END) as accepted,
      COUNT(DISTINCT CASE WHEN fm.status = 'excluded' THEN f.id END) as excluded
    FROM field f
    JOIN entity e ON e.id = f.entity_id AND e.side = 'target'
    LEFT JOIN field_mapping fm ON fm.target_field_id = f.id AND fm.is_latest = true AND fm.transfer_id IS NULL
    GROUP BY 1
    ORDER BY 1
  `);

  console.log("\nMilestone  | Fields | Mapped | Source | Review | Accepted | Excluded | Gap");
  console.log("-".repeat(85));
  let gt = 0, gm = 0, gs = 0, gr = 0, ga = 0, ge = 0, gg = 0;
  for (const r of rows as any[]) {
    const total = parseInt(r.total_fields);
    const mapped = parseInt(r.has_mapping);
    const src = parseInt(r.has_source);
    const rev = parseInt(r.has_review);
    const acc = parseInt(r.accepted);
    const exc = parseInt(r.excluded);
    const gap = total - mapped;
    gt += total; gm += mapped; gs += src; gr += rev; ga += acc; ge += exc; gg += gap;
    console.log(
      `${(r.milestone as string).padEnd(10)} | ${String(total).padStart(6)} | ${String(mapped).padStart(6)} | ${String(src).padStart(6)} | ${String(rev).padStart(6)} | ${String(acc).padStart(8)} | ${String(exc).padStart(8)} | ${String(gap).padStart(3)}`
    );
  }
  console.log("-".repeat(85));
  console.log(
    `${"TOTAL".padEnd(10)} | ${String(gt).padStart(6)} | ${String(gm).padStart(6)} | ${String(gs).padStart(6)} | ${String(gr).padStart(6)} | ${String(ga).padStart(8)} | ${String(ge).padStart(8)} | ${String(gg).padStart(3)}`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
