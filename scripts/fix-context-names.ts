/**
 * Fix acronym casing in context names.
 *
 * The original slug-to-label conversion only capitalizes the first letter,
 * producing "Cfpb" instead of "CFPB". This script fixes all known acronyms.
 *
 * Usage: npx tsx scripts/fix-context-names.ts [--dry-run]
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);
const dryRun = process.argv.includes("--dry-run");

// Map of wrong → correct for known acronyms.
// Order matters: longer patterns first to avoid partial matches.
const ACRONYM_FIXES: [RegExp, string][] = [
  // Federal regulatory bodies & laws
  [/\bCfpb\b/g, "CFPB"],
  [/\bFcra\b/g, "FCRA"],
  [/\bFdcpa\b/g, "FDCPA"],
  [/\bFincen\b/g, "FinCEN"],
  [/\bGlba\b/g, "GLBA"],
  [/\bHpa\b/g, "HPA"],
  [/\bScra\b/g, "SCRA"],
  [/\bTcpa\b/g, "TCPA"],
  [/\bUdaap\b/g, "UDAAP"],
  [/\bOfac\b/g, "OFAC"],

  // Government agencies & programs
  [/\bFha\b/g, "FHA"],
  [/\bUsda\b/g, "USDA"],
  [/\bCwcot\b/g, "CWCOT"],

  // GSEs & industry
  [/\bGse\b/g, "GSE"],
  [/\bMbs\b/g, "MBS"],
  [/\bMers\b/g, "MERS"],

  // Loan types & terms
  [/\bArm\b/g, "ARM"],
  [/\bHeloc\b/g, "HELOC"],

  // Insurance
  [/\bMi\b/g, "MI"],
  [/\bPmi\b/g, "PMI"],

  // Geographic — be careful with "Va" (Veterans Affairs vs Virginia)
  // Only fix "Va" when it's NOT followed by a lowercase letter (i.e., not part of "Valon", "Valuation", etc.)
  // In our data, "Va" only appears as "Government Insurers > Va > ..." path segments
  [/\bVa\b(?!\w)/g, "VA"],
  [/\bDc\b/g, "DC"],

  // Fix "District Of Columbia" → "District of Columbia" (lowercase preposition)
  [/\bDistrict Of Columbia\b/g, "District of Columbia"],
];

function fixName(name: string): string {
  let fixed = name;
  for (const [pattern, replacement] of ACRONYM_FIXES) {
    fixed = fixed.replace(pattern, replacement);
  }
  return fixed;
}

// Fetch all contexts
const rows = db
  .prepare("SELECT id, name FROM context")
  .all() as { id: string; name: string }[];

const updates: { id: string; oldName: string; newName: string }[] = [];

for (const row of rows) {
  const newName = fixName(row.name);
  if (newName !== row.name) {
    updates.push({ id: row.id, oldName: row.name, newName });
  }
}

console.log(`Found ${updates.length} names to fix out of ${rows.length} total contexts.\n`);

if (updates.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

// Show preview
for (const u of updates) {
  console.log(`  "${u.oldName}"`);
  console.log(`  → "${u.newName}"\n`);
}

if (dryRun) {
  console.log("Dry run — no changes made.");
  process.exit(0);
}

// Apply updates
const stmt = db.prepare("UPDATE context SET name = ?, updated_at = ? WHERE id = ?");
const now = new Date().toISOString();

const applyAll = db.transaction(() => {
  for (const u of updates) {
    stmt.run(u.newName, now, u.id);
  }
});

applyAll();
console.log(`Updated ${updates.length} context names.`);

db.close();
