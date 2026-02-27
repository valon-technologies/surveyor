// DEPRECATED: Use scripts/seed-from-mapping-engine.ts instead
/**
 * Import ServiceMac mapping session transcripts as adhoc/transcript context docs.
 *
 * Usage: npx tsx scripts/import-transcripts.ts
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const TRANSCRIPTS_DIR = "/Users/grantlee/Dev/mapping-skills/servicemac-m1/transcripts";
const WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";

const db = new Database(DB_PATH);

const transcripts = [
  { file: "day-1-morning-mapping.md", name: "ServiceMac > Day 1 Morning — Loan, Escrow, Investor" },
  { file: "day-1-afternoon-mapping.md", name: "ServiceMac > Day 1 Afternoon — Cash, Collections, Loss Mit" },
  { file: "day-2-morning-mapping.md", name: "ServiceMac > Day 2 Morning — Foreclosure, Bankruptcy, Claims" },
  { file: "day-2-afternoon-mapping.md", name: "ServiceMac > Day 2 Afternoon — REO, Makeup Sessions" },
];

const insertContext = db.prepare(`
  INSERT OR IGNORE INTO context (
    id, workspace_id, name, category, subcategory, entity_id, field_id,
    content, content_format, token_count, tags, is_active, sort_order,
    import_source, metadata, created_at, updated_at
  ) VALUES (
    @id, @workspace_id, @name, 'adhoc', 'transcript', NULL, NULL,
    @content, 'markdown', @token_count, @tags, 1, @sort_order,
    @import_source, NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
`);

let imported = 0;
let skipped = 0;

const importAll = db.transaction(() => {
  for (let i = 0; i < transcripts.length; i++) {
    const t = transcripts[i];
    const filePath = path.join(TRANSCRIPTS_DIR, t.file);
    const content = fs.readFileSync(filePath, "utf-8").trim();

    const hash = crypto.createHash("md5").update(`transcript/${t.file}`).digest("hex");
    const uuid = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");

    const tokenCount = Math.round(content.length / 4);

    const result = insertContext.run({
      id: uuid,
      workspace_id: WORKSPACE_ID,
      name: t.name,
      content,
      token_count: tokenCount,
      tags: JSON.stringify(["servicemac", "transcript", "mapping-session"]),
      sort_order: i,
      import_source: `servicemac-m1/transcripts/${t.file}`,
    });

    if (result.changes > 0) {
      imported++;
      console.log(`  [+] ${t.name} (${tokenCount} tokens)`);
    } else {
      skipped++;
      console.log(`  [=] ${t.name} (already exists)`);
    }
  }
});

importAll();

console.log(`\nImport complete: ${imported} created, ${skipped} skipped.`);
db.close();
