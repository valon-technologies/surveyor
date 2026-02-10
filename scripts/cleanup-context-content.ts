/**
 * Clean up context content for LLM consumption.
 *
 * Fixes:
 * 1. Remove "## Resources" sections (dead .md links; content already inlined)
 * 2. Convert dead .md file links to plain text references
 * 3. Fix section headers from FILENAME format to Title Case
 * 4. Remove skill-system directives ("You MUST read the full...")
 * 5. Strip dead ONBOARDING-REFERENCE.md links
 * 6. Populate token_count for all contexts
 *
 * Usage: npx tsx scripts/cleanup-context-content.ts [--dry-run]
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);
const dryRun = process.argv.includes("--dry-run");

// --- Content cleanup functions ---

/**
 * Remove "## Resources" sections entirely.
 * These contain links to .md files whose content is already inlined below.
 */
function removeResourcesSections(content: string): string {
  // Match "## Resources" header through to next ## header or --- separator
  return content.replace(
    /## Resources\n(?:.*\n)*?(?=\n---\n|\n## (?!Resources)|$)/g,
    ""
  );
}

/**
 * Convert dead .md links to plain text.
 * [FIELDS.md](FIELDS.md) → "Fields"
 * [ESCROW-ANALYSIS.md](ESCROW-ANALYSIS.md) → "Escrow Analysis"
 * [ONBOARDING-REFERENCE.md](../../ONBOARDING-REFERENCE.md) → "Onboarding Reference"
 */
function fixDeadMdLinks(content: string): string {
  return content.replace(
    /\[([^\]]*\.md)\]\([^)]*\.md\)/g,
    (_match, linkText: string) => {
      // Convert "FIELDS.md" → "Fields", "ESCROW-ANALYSIS.md" → "Escrow Analysis"
      return linkText
        .replace(/\.md$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/^(.)/g, (c) => c.toUpperCase());
    }
  );
}

/**
 * Remove skill-system directives that reference .md files.
 * Lines like: "**You MUST read the full [FIELDS.md]..."
 * Or: "See [ONBOARDING-REFERENCE.md]..."
 */
function removeSkillDirectives(content: string): string {
  // Remove lines that are skill directives referencing .md files
  return content.replace(
    /^.*(?:You MUST read|MUST read the full|See \[?ONBOARDING-REFERENCE).*$/gm,
    ""
  );
}

/**
 * Fix section headers that are FILENAME format.
 * "## ESCROW ANALYSIS" → "## Escrow Analysis"
 * "## FIELDS" → "## Fields"
 * Only fix headers that are ALL CAPS (leave mixed case alone).
 */
function fixSectionHeaders(content: string): string {
  return content.replace(
    /^(#{1,4}) ([A-Z][A-Z _]+)$/gm,
    (_match, hashes: string, title: string) => {
      // Only fix if the title is all uppercase (or uppercase + spaces/underscores)
      if (title !== title.toUpperCase()) return _match;
      const fixed = title
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      return `${hashes} ${fixed}`;
    }
  );
}

/**
 * Clean up excess blank lines (3+ consecutive → 2).
 */
function collapseBlankLines(content: string): string {
  return content.replace(/\n{4,}/g, "\n\n\n");
}

/**
 * Remove "See X for details" lines that reference removed links.
 * But keep "See X" lines that reference actual inline content.
 */
function cleanOrphanSeeReferences(content: string): string {
  // Remove lines like "See Onboarding Reference and Implementation for details."
  // where the referenced files aren't inlined
  return content.replace(
    /^See (?:the )?Onboarding Reference.*$/gm,
    ""
  );
}

function cleanContent(content: string): string {
  let cleaned = content;
  cleaned = removeResourcesSections(cleaned);
  cleaned = removeSkillDirectives(cleaned);
  cleaned = fixDeadMdLinks(cleaned);
  cleaned = fixSectionHeaders(cleaned);
  cleaned = cleanOrphanSeeReferences(cleaned);
  cleaned = collapseBlankLines(cleaned);
  return cleaned.trim();
}

/**
 * Estimate token count (~4 chars per token for English text).
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

// --- Main ---

const rows = db
  .prepare("SELECT id, name, content FROM context")
  .all() as { id: string; name: string; content: string }[];

let contentChanges = 0;
let tokenUpdates = 0;

const updates: { id: string; name: string; content: string; tokenCount: number; changed: boolean }[] = [];

for (const row of rows) {
  const cleaned = cleanContent(row.content);
  const tokenCount = estimateTokens(cleaned);
  const changed = cleaned !== row.content;

  if (changed) contentChanges++;
  tokenUpdates++;

  updates.push({
    id: row.id,
    name: row.name,
    content: cleaned,
    tokenCount,
    changed,
  });
}

console.log(`Content changes: ${contentChanges} of ${rows.length} contexts`);
console.log(`Token counts to set: ${tokenUpdates}\n`);

// Show preview of content changes
if (dryRun) {
  for (const u of updates.filter((u) => u.changed)) {
    const originalLen = rows.find((r) => r.id === u.id)!.content.length;
    const newLen = u.content.length;
    const diff = originalLen - newLen;
    console.log(`  ${u.name}`);
    console.log(`    ${originalLen} → ${newLen} chars (−${diff}), ~${u.tokenCount} tokens\n`);
  }
  console.log("Dry run — no changes made.");
  process.exit(0);
}

// Apply updates
const stmt = db.prepare(
  "UPDATE context SET content = ?, token_count = ?, updated_at = ? WHERE id = ?"
);
const now = new Date().toISOString();

const applyAll = db.transaction(() => {
  for (const u of updates) {
    stmt.run(u.content, u.tokenCount, now, u.id);
  }
});

applyAll();
console.log(`Updated ${contentChanges} contexts with cleaned content.`);
console.log(`Set token_count on all ${tokenUpdates} contexts.`);

db.close();
