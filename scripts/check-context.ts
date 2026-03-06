import { db } from "../src/lib/db";
import { context } from "../src/lib/db/schema";
import { eq, and, count, sql } from "drizzle-orm";

async function main() {
  const wsId = "2ac4e497-1c82-4b0d-a86e-83bec30761c8";

  const docs = await db
    .select({
      subcategory: context.subcategory,
      cnt: count(),
      tokens: sql<number>`SUM(COALESCE(${context.tokenCount}, 0))`,
    })
    .from(context)
    .where(
      and(
        eq(context.workspaceId, wsId),
        eq(context.category, "foundational"),
        eq(context.isActive, true),
      )
    )
    .groupBy(context.subcategory);

  console.log("Foundational docs by subcategory:");
  for (const d of docs.sort((a, b) => Number(b.tokens) - Number(a.tokens))) {
    console.log(`  ${d.subcategory || "(none)"}: ${d.cnt} docs, ~${Number(d.tokens)} tokens`);
  }

  // Also check what the Python script's learnings file looks like
  const { readFileSync } = await import("fs");
  try {
    const learnings = readFileSync("data/transfers/stockton/corrections.json", "utf-8");
    console.log(`\nCorrections.json size: ${learnings.length} chars`);
  } catch {}

  // Check distilled learnings if available
  try {
    const distilled = readFileSync("/Users/rob/code/servicing-transfer-mapping/learnings/distilled-learnings.md", "utf-8");
    console.log(`Distilled learnings: ${distilled.length} chars (~${Math.ceil(distilled.length / 4)} tokens)`);
  } catch {}

  process.exit(0);
}
main();
