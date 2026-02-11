/**
 * Import ServiceMac mapping session transcripts as adhoc/transcript context docs.
 *
 * Usage: npx tsx scripts/import-transcripts.ts
 */

import postgres from "postgres";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import "dotenv/config";

const TRANSCRIPTS_DIR = "/Users/grantlee/Dev/mapping-skills/servicemac-m1/transcripts";
const WORKSPACE_ID = "847602b2-188d-4fca-b1b1-d6098bb22aba";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });

const transcripts = [
  { file: "day-1-morning-mapping.md", name: "ServiceMac > Day 1 Morning — Loan, Escrow, Investor" },
  { file: "day-1-afternoon-mapping.md", name: "ServiceMac > Day 1 Afternoon — Cash, Collections, Loss Mit" },
  { file: "day-2-morning-mapping.md", name: "ServiceMac > Day 2 Morning — Foreclosure, Bankruptcy, Claims" },
  { file: "day-2-afternoon-mapping.md", name: "ServiceMac > Day 2 Afternoon — REO, Makeup Sessions" },
];

async function main() {
  let imported = 0;
  let skipped = 0;

  await client.begin(async (tx) => {
    for (let i = 0; i < transcripts.length; i++) {
      const t = transcripts[i];
      const filePath = path.join(TRANSCRIPTS_DIR, t.file);
      const content = fs.readFileSync(filePath, "utf-8").trim();

      const hash = crypto.createHash("md5").update(`transcript/${t.file}`).digest("hex");
      const uuid = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");

      const tokenCount = Math.round(content.length / 4);

      const result = await tx`
        INSERT INTO context (
          id, workspace_id, name, category, subcategory, entity_id, field_id,
          content, content_format, token_count, tags, is_active, sort_order,
          import_source, metadata, created_at, updated_at
        ) VALUES (
          ${uuid}, ${WORKSPACE_ID}, ${t.name}, 'adhoc', 'transcript', NULL, NULL,
          ${content}, 'markdown', ${tokenCount}, ${JSON.stringify(["servicemac", "transcript", "mapping-session"])}, true, ${i},
          ${"servicemac-m1/transcripts/" + t.file}, NULL,
          NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;

      if (result.count > 0) {
        imported++;
        console.log(`  [+] ${t.name} (${tokenCount} tokens)`);
      } else {
        skipped++;
        console.log(`  [=] ${t.name} (already exists)`);
      }
    }
  });

  console.log(`\nImport complete: ${imported} created, ${skipped} skipped.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
