/**
 * Cleanup Inline Enum Claims from ServiceMac Table Contexts
 *
 * Problem: Table context docs contain hardcoded enum value summaries like
 * "BorrowerIndicator (1=Primary, 2=Co)" that contradict the authoritative
 * enum docs. The LLM trusts these inline claims over the actual enum context.
 *
 * Solution: Replace inline enum claims with cross-references to the
 * authoritative enum context, forcing the LLM to look up real values.
 *
 * Usage:
 *   npx tsx scripts/cleanup-inline-enums.ts           # dry-run (default)
 *   npx tsx scripts/cleanup-inline-enums.ts --apply    # apply changes
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "surveyor.db");
const DRY_RUN = !process.argv.includes("--apply");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ─── Types ─────────────────────────────────────────────────────

interface ContextRow {
  id: string;
  name: string;
  content: string;
  tokenCount: number | null;
}

interface EnumContextRow {
  id: string;
  name: string;
  tableName: string; // normalized: "LOANINFO", "BORROWERDEMOGRAPHICS", etc.
}

interface Replacement {
  contextId: string;
  contextName: string;
  lineNum: number;
  original: string;
  replaced: string;
  pattern: string;
  enumRef: string | null;
}

// ─── Build enum lookup ─────────────────────────────────────────

function buildEnumLookup(): Map<string, EnumContextRow> {
  const rows = db
    .prepare(
      `SELECT id, name FROM context
       WHERE name LIKE 'ServiceMac > Enums > %' AND is_active = 1`
    )
    .all() as { id: string; name: string }[];

  const lookup = new Map<string, EnumContextRow>();
  for (const row of rows) {
    // "ServiceMac > Enums > LOANINFO ENUMS" → "LOANINFO"
    const match = row.name.match(/ServiceMac > Enums > (.+) ENUMS$/);
    if (match) {
      const tableName = match[1].toUpperCase();
      lookup.set(tableName, { id: row.id, name: row.name, tableName });
    }
  }
  return lookup;
}

// Map table display names to their normalized enum lookup key
const TABLE_TO_ENUM_KEY: Record<string, string> = {
  "ARM": "ARM",
  "Borrower Demographics": "BORROWERDEMOGRAPHICS",
  "Call Log": "CALLLOG",
  "Claims": "CLAIMS",
  "Collateral": "COLLATERAL",
  "Deceased Borrower": "DECEASEDBORROWER",
  "Default Workstations": "DEFAULTWORKSTATIONS",
  "Econsent": "ECONSENT",
  "Escrow Analysis History": "ESCROWANALYSISHISTORY",
  "Event Dates": "EVENTDATES",
  "Flood Information History": "FLOODINFORMATIONHISTORY",
  "HELOC": "HELOC",
  "HELOC Segments": "HELOCSEGMENTS",
  "HELOC Transactions Segmented": "HELOCTRANSACTIONSSEGMENTED",
  "Hazard Insurance": "HAZARDINSURANCE",
  "Investor": "INVESTOR",
  "Letter": "LETTER",
  "Loan Info": "LOANINFO",
  "Loan Investor History": "LOANINVESTORHISTORY",
  "MBS Pool": "MBSPOOL",
  "Military Relief": "MILITARYRELIEF",
  "Non Borrower": "NONBORROWER",
  "Notes": "NOTES",
  "Notification Type": "NOTIFICATIONTYPE",
  "Party": "PARTY",
  "Payee": "PAYEE",
  "Payment Factors": "PAYMENTFACTORS",
  "Payoff Statement": "PAYOFFSTATEMENT",
  "Prior Servicer": "PRIORSERVICER",
  "Property Inspection": "PROPERTYINSPECTION",
  "Property Preservation": "PROPERTYPRESERVATION",
  "S2MR": "S2MR",
  "Step": "STEP",
  "Stops Flags Indicators": "STOPSFLAGSANDINDICATORS",
  "Task Id": "TASKID",
  "Task Tracking": "TASKTRACKING",
  "Tax": "TAX",
  "Telephone Numbers": "TELEPHONENUMBERS",
  "Transaction": "TRANSACTION",
};

// ─── Patterns to detect inline enum claims ─────────────────────

/**
 * Patterns that match inline enum value claims in markdown.
 *
 * These capture common ways table docs state enum values:
 * - In table cells: "F=Fannie, H=Freddie, G=Ginnie"
 * - In parenthetical claims: "(1=Primary, 2=Co)"
 * - Inline descriptions: "1/5=FHA, 2=VA, 7=PIH, 9=RHS"
 */

// Match: X=Label, Y=Label (2+ comma-separated code=label pairs in a table cell)
// e.g., "F=Fannie, H=Freddie, G=Ginnie, O=Other"
// e.g., "1=Primary, 2=Second, 3=Investment"
const ENUM_CLAIM_IN_CELL = /(?:[\w/]+=[A-Z][\w\s/()]+(?:,\s*)?){2,}/i;

// Match: (X=Label, Y=Label) — parenthetical enum claims
// e.g., "(1=Primary, 2=Co-borrower)"
const ENUM_CLAIM_PAREN = /\((?:[\w/]+=[A-Z][\w\s/()-]+(?:,\s*)?){2,}\)/i;

// Match: "code: X = Y" style
const ENUM_CLAIM_COLON = /(?:code|value|type):\s*[\w]+\s*=\s*[\w\s]+/i;

// Match specific well-known incorrect claims
const SPECIFIC_CLAIMS: [RegExp, string][] = [
  // BorrowerIndicator 1/2 claim (the triggering issue)
  [/BorrowerIndicator\s*(?:\(|=\s*)?1\s*=\s*Primary/i, "BorrowerIndicator"],
  [/BorrowerIndicator\s*\(1=Primary,?\s*2=Co(?:-?borrower)?\)/i, "BorrowerIndicator"],
  // GseCode inline
  [/F=Fannie,?\s*H=Freddie,?\s*G=Ginnie[^)|]*/i, "GseCode"],
  // OccupancyCode inline
  [/1=Primary,?\s*2=Second(?:\s*Home)?,?\s*3=Investment/i, "OccupancyCode"],
  // LoType inline claims — match the whole parenthetical or cell content
  [/\(1(?:\/5)?=FHA[^)]*\)/i, "LoType"],
  [/(?:3=Conventional,?\s*)?(?:1(?:\/5)?=FHA|6=FHA),?\s*(?:2|9)=VA[^|]*/i, "LoType"],
  // PropertyStateCode numeric claims — replace the whole parenthetical
  [/\(4=CA[^)]*\)/i, "PropertyStateCode"],
  [/numeric codes\s*\([^)]*\)/i, "PropertyStateCode"],
];

// ─── Line-level analysis ───────────────────────────────────────

function analyzeLineForEnumClaims(
  line: string,
  lineNum: number,
  enumRef: string | null,
): Replacement | null {
  // Skip lines that ARE the cross-reference already
  if (line.includes("See the relevant") && line.includes("ENUMS")) return null;
  if (line.includes("see BORROWERDEMOGRAPHICS ENUMS")) return null;
  if (line.includes("Enum values for this domain")) return null;

  // Skip code blocks (SQL, data model diagrams)
  if (line.startsWith("```") || line.startsWith("FROM ") || line.startsWith("SELECT ")) return null;
  if (line.startsWith("WHERE ") || line.startsWith("LEFT JOIN")) return null;

  // Skip lines that are just markdown headers
  if (/^#{1,4}\s/.test(line) && !ENUM_CLAIM_IN_CELL.test(line)) return null;

  // Check specific well-known claims first
  for (const [pattern, fieldName] of SPECIFIC_CLAIMS) {
    if (pattern.test(line)) {
      const ref = enumRef ? `see ${enumRef} for valid codes` : `see enum reference for valid codes`;
      const replaced = line.replace(pattern, `${fieldName} — ${ref}`);
      if (replaced !== line) {
        return {
          contextId: "",
          contextName: "",
          lineNum,
          original: line.trim(),
          replaced: replaced.trim(),
          pattern: `specific:${fieldName}`,
          enumRef,
        };
      }
    }
  }

  // Check for table cell patterns: | ... X=Label, Y=Label ... |
  if (line.includes("|")) {
    const cells = line.split("|").map((c) => c.trim());
    let modified = false;
    const newCells = cells.map((cell) => {
      if (!cell) return cell;

      // Count code=label pairs in this cell
      const pairs = cell.match(/[\w/]+=[A-Z][\w\s/()-]+/gi);
      if (pairs && pairs.length >= 2) {
        // This cell contains 2+ enum value claims
        const ref = enumRef || "enum reference";
        modified = true;
        return `See ${ref}`;
      }
      return cell;
    });

    if (modified) {
      const replaced = newCells.join(" | ");
      return {
        contextId: "",
        contextName: "",
        lineNum,
        original: line.trim(),
        replaced: replaced.trim(),
        pattern: "table_cell_enum_pairs",
        enumRef,
      };
    }
  }

  // Check for parenthetical enum claims in prose
  const parenMatch = line.match(ENUM_CLAIM_PAREN);
  if (parenMatch) {
    const ref = enumRef ? `(see ${enumRef})` : "(see enum reference)";
    const replaced = line.replace(ENUM_CLAIM_PAREN, ref);
    return {
      contextId: "",
      contextName: "",
      lineNum,
      original: line.trim(),
      replaced: replaced.trim(),
      pattern: "paren_enum_claim",
      enumRef,
    };
  }

  return null;
}

// ─── Process a single context ──────────────────────────────────

function processContext(
  ctx: ContextRow,
  enumLookup: Map<string, EnumContextRow>,
): { replacements: Replacement[]; newContent: string } {
  // Resolve which enum context this table maps to
  const tableDisplayName = ctx.name.replace("ServiceMac > Tables > ", "");
  const enumKey = TABLE_TO_ENUM_KEY[tableDisplayName];
  const enumCtx = enumKey ? enumLookup.get(enumKey) : null;
  const enumRefLabel = enumCtx ? enumCtx.name : null;

  const lines = ctx.content.split("\n");
  const replacements: Replacement[] = [];
  let inCodeBlock = false;

  const newLines = lines.map((line, i) => {
    // Track code block state
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) return line;

    const rep = analyzeLineForEnumClaims(line, i + 1, enumRefLabel);
    if (rep) {
      rep.contextId = ctx.id;
      rep.contextName = ctx.name;
      replacements.push(rep);
      // Reconstruct the line preserving leading whitespace
      const leadingWs = line.match(/^(\s*)/)?.[1] || "";
      return leadingWs + rep.replaced;
    }
    return line;
  });

  // If this table has an enum context and the doc doesn't already mention it,
  // add a cross-reference note after the first "## Key Fields" or "## Field" heading
  if (enumCtx && replacements.length > 0) {
    const enumNote = `\n> **Enum Reference**: For all code/value lookups in this table, see \`${enumCtx.name}\`.\n`;
    const insertIdx = newLines.findIndex(
      (l) => /^##\s+(Key\s+)?Field/i.test(l)
    );

    // Only add if not already present
    const alreadyHasRef = newLines.some(
      (l) => l.includes(enumCtx.name) || l.includes("Enum Reference")
    );

    if (insertIdx >= 0 && !alreadyHasRef) {
      newLines.splice(insertIdx + 1, 0, enumNote);
    }
  }

  return {
    replacements,
    newContent: newLines.join("\n"),
  };
}

// ─── Main ──────────────────────────────────────────────────────

function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  Cleanup Inline Enum Claims — ${DRY_RUN ? "DRY RUN" : "APPLYING CHANGES"}`);
  console.log(`${"=".repeat(70)}\n`);

  const enumLookup = buildEnumLookup();
  console.log(`Found ${enumLookup.size} enum contexts:`);
  for (const [key, ctx] of enumLookup) {
    console.log(`  ${key} → ${ctx.name}`);
  }
  console.log();

  // Load all ServiceMac table contexts
  const tableContexts = db
    .prepare(
      `SELECT id, name, content, token_count as tokenCount
       FROM context
       WHERE name LIKE 'ServiceMac > Tables > %' AND is_active = 1
       ORDER BY name`
    )
    .all() as ContextRow[];

  console.log(`Processing ${tableContexts.length} table contexts...\n`);

  let totalReplacements = 0;
  let contextsModified = 0;
  const allReplacements: Replacement[] = [];

  for (const ctx of tableContexts) {
    const { replacements, newContent } = processContext(ctx, enumLookup);

    if (replacements.length > 0) {
      contextsModified++;
      totalReplacements += replacements.length;
      allReplacements.push(...replacements);

      const tableDisplayName = ctx.name.replace("ServiceMac > Tables > ", "");
      const enumKey = TABLE_TO_ENUM_KEY[tableDisplayName];
      const hasEnum = enumKey && enumLookup.has(enumKey);

      console.log(
        `\n📄 ${ctx.name} (${replacements.length} replacements${hasEnum ? ", has enum ✓" : ", NO enum context"})`
      );

      for (const rep of replacements) {
        console.log(`  L${rep.lineNum} [${rep.pattern}]`);
        console.log(`    - ${rep.original.slice(0, 120)}`);
        console.log(`    + ${rep.replaced.slice(0, 120)}`);
      }

      if (!DRY_RUN) {
        // Rough token estimate: 1 token ≈ 4 chars
        const newTokenCount = Math.ceil(newContent.length / 4);

        db.prepare(
          `UPDATE context
           SET content = ?, token_count = ?, updated_at = ?
           WHERE id = ?`
        ).run(newContent, newTokenCount, new Date().toISOString(), ctx.id);

        // Update FTS5 index
        try {
          db.prepare(`DELETE FROM context_fts WHERE context_id = ?`).run(ctx.id);
          db.prepare(
            `INSERT INTO context_fts (context_id, workspace_id, name, content, tags)
             SELECT id, workspace_id, name, content,
               (SELECT GROUP_CONCAT(value, ' ') FROM json_each(tags))
             FROM context WHERE id = ?`
          ).run(ctx.id);
        } catch {
          // FTS5 table may not exist
        }
      }
    }
  }

  // Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  Summary`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Table contexts processed: ${tableContexts.length}`);
  console.log(`  Contexts modified:        ${contextsModified}`);
  console.log(`  Total replacements:       ${totalReplacements}`);
  console.log();

  if (totalReplacements > 0) {
    // Group by pattern type
    const byPattern = new Map<string, number>();
    for (const rep of allReplacements) {
      byPattern.set(rep.pattern, (byPattern.get(rep.pattern) || 0) + 1);
    }
    console.log("  By pattern:");
    for (const [pattern, count] of [...byPattern].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${pattern}: ${count}`);
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("  ⚠️  DRY RUN — no changes applied. Run with --apply to apply.\n");
  } else {
    console.log("  ✅ Changes applied to database and FTS5 index.\n");
  }

  db.close();
}

main();
