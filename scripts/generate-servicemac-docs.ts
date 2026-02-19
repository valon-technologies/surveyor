/**
 * Generate accurate ServiceMac context docs from actual entity/field data in the DB.
 *
 * This script:
 * 1. Reads real source entities + fields from the Surveyor DB
 * 2. Generates SKILL.md + FIELD-REFERENCE.md for each entity in mapping-skills
 * 3. Regenerates the top-level SKILL.md table listing
 * 4. Upserts all ServiceMac contexts into the DB (tables + top-level + domains + enums)
 *
 * Usage: npx tsx scripts/generate-servicemac-docs.ts
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const SM_ROOT =
  "/Users/grantlee/Dev/mapping-skills/.claude/skills/servicemac-domain";
const TABLES_DIR = path.join(SM_ROOT, "tables");
const WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";

const db = new Database(DB_PATH);

// ─── Helpers ───────────────────────────────────────────────────

const ACRONYMS: Record<string, string> = {
  cfpb: "CFPB", fcra: "FCRA", fdcpa: "FDCPA", fincen: "FinCEN",
  glba: "GLBA", hpa: "HPA", scra: "SCRA", tcpa: "TCPA",
  udaap: "UDAAP", ofac: "OFAC", fha: "FHA", usda: "USDA",
  va: "VA", gse: "GSE", mbs: "MBS", mers: "MERS", cwcot: "CWCOT",
  arm: "ARM", heloc: "HELOC", mi: "MI", pmi: "PMI", dc: "DC",
  reo: "REO", hud: "HUD", respa: "RESPA", tila: "TILA",
  qc: "QC", ach: "ACH", api: "API", llc: "LLC", lp: "LP",
  poc: "POC", sm: "SM", vds: "VDS", acdc: "ACDC",
  sql: "SQL", s2mr: "S2MR", dq: "DQ", pi: "P&I",
  mbspool: "MBSPOOL",
};

function slugify(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase → camel-Case
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase();
}

function slugToLabel(slug: string): string {
  return slug
    .replace(/\.md$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b\w+\b/g, (word) => ACRONYMS[word.toLowerCase()] ?? word);
}

function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end !== -1) return content.slice(end + 3).trim();
  }
  return content.trim();
}

function deterministicId(key: string): string {
  const hash = crypto.createHash("md5").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

// ─── Schema Asset Descriptions ─────────────────────────────────
// Brief descriptions for entities that don't have one in the DB

const ENTITY_DESCRIPTIONS: Record<string, string> = {
  Arm: "Adjustable rate mortgage data including rate indices, change schedules, caps, and calculation parameters.",
  BorrowerDemographics: "HMDA demographic data for primary and co-borrowers including ethnicity, race, sex, and income.",
  ClientToClientTransfers: "Records of loan transfers between ServiceMac clients.",
  DefaultWorkstations: "Default servicing workstation fields covering BANK (bankruptcy), FORE (foreclosure), LSMT (loss mitigation), and REO workflows.",
  EventDates: "All date-type fields for loan lifecycle events — acquisition, maturity, payoff, foreclosure, bankruptcy, loss mitigation, and more.",
  HazardInsurance: "Hazard insurance policy data including coverage amounts, premiums, expiration dates, and force-placed tracking.",
  Heloc: "Home equity line of credit master data including draw periods, limits, and segmented balances.",
  HelocSegments: "Individual draw segments for HELOC loans with segment-level balances and rates.",
  Investor: "Investor master reference table — investor codes, names, remittance methods, GSE rules, and reporting parameters.",
  Letter: "Borrower correspondence records with letter IDs, dates, and mailing status.",
  LoanInfo: "Primary loan table (853 columns) — the central source for loan attributes including balances, rates, terms, dates, borrower info, investor codes, escrow, and status fields.",
  LossMitigation: "Loss mitigation tracking including workout types (forbearance, modification, deferral), stage codes, and resolution dates.",
  SegmentedTransaction: "HELOC segmented transaction details.",
  Step: "Workflow step tracking for BANK, FORE, LSMT, and REO workstations — step codes with scheduled and actual completion dates.",
  StopsFlagsAndIndicators: "All stop codes, flags, and indicator fields (542 columns) controlling loan processing behavior — payment stops, collection stops, escrow stops, and feature indicators.",
  Tax: "Tax parcel data including parcel IDs, amounts, disbursement dates, and delinquency tracking.",
  Transaction: "Payment and disbursement transaction records with amounts applied to principal, interest, escrow, fees, suspense, and advance balances.",
  BankruptcyHistory: "Bankruptcy history per loan, including court/case details and bar date. One row per loan per history segment.",
  BankruptcyLedger: "Bankruptcy ledger history entries with key record types, effective dates, and transaction attributes.",
  "MBSPOOL Fields": "MBS pool reference data with pool numbers, types, and security identifiers. Field definitions not available.",
};

// ─── Read Real Data ────────────────────────────────────────────

interface EntityRow {
  id: string;
  name: string;
  asset_name: string;
  description: string | null;
  field_count: number;
}

interface FieldRow {
  name: string;
  data_type: string | null;
  is_required: number;
  is_key: number;
  description: string | null;
  domain_tag: string | null;
  enum_values: string | null;
  sample_values: string | null;
}

const entities = db
  .prepare(
    `SELECT e.id, e.name, sa.name as asset_name, e.description,
            (SELECT COUNT(*) FROM field f WHERE f.entity_id = e.id) as field_count
     FROM entity e
     JOIN schema_asset sa ON e.schema_asset_id = sa.id
     WHERE sa.side = 'source'
     ORDER BY e.name`
  )
  .all() as EntityRow[];

console.log(`Found ${entities.length} source entities in DB\n`);

// ─── Step 1: Generate new docs ─────────────────────────────────

fs.mkdirSync(TABLES_DIR, { recursive: true });

for (const entity of entities) {
  const fields = db
    .prepare(
      `SELECT name, data_type, is_required, is_key, description, domain_tag, enum_values, sample_values
       FROM field WHERE entity_id = ? ORDER BY sort_order, name`
    )
    .all(entity.id) as FieldRow[];

  const slug = slugify(entity.name);
  const entityDir = path.join(TABLES_DIR, slug);
  fs.mkdirSync(entityDir, { recursive: true });

  const desc =
    entity.description || ENTITY_DESCRIPTIONS[entity.name] || "";
  const keyFields = fields.filter((f) => f.is_key);
  const requiredFields = fields.filter((f) => f.is_required && !f.is_key);
  const enumFields = fields.filter(
    (f) => f.enum_values && f.enum_values !== "[]"
  );

  // Group fields by domain_tag if available
  const domainGroups = new Map<string, FieldRow[]>();
  for (const f of fields) {
    const tag = f.domain_tag || "general";
    if (!domainGroups.has(tag)) domainGroups.set(tag, []);
    domainGroups.get(tag)!.push(f);
  }

  // --- SKILL.md ---
  const skillLines: string[] = [
    `# ${entity.name}`,
    "",
    `> **Source**: ${entity.asset_name} | **Fields**: ${fields.length}`,
    "",
  ];

  if (desc) {
    skillLines.push(desc, "");
  }

  // Key fields
  if (keyFields.length > 0) {
    skillLines.push("## Key Fields", "");
    skillLines.push("| Field | Type | Description |");
    skillLines.push("|-------|------|-------------|");
    for (const f of keyFields) {
      skillLines.push(
        `| \`${f.name}\` | ${f.data_type || "—"} | ${f.description || "—"} |`
      );
    }
    skillLines.push("");
  }

  // Required (non-key) fields
  if (requiredFields.length > 0) {
    skillLines.push("## Required Fields", "");
    skillLines.push("| Field | Type | Description |");
    skillLines.push("|-------|------|-------------|");
    for (const f of requiredFields) {
      skillLines.push(
        `| \`${f.name}\` | ${f.data_type || "—"} | ${f.description || "—"} |`
      );
    }
    skillLines.push("");
  }

  // Fields with enum values (quick reference)
  if (enumFields.length > 0) {
    skillLines.push("## Fields with Known Values", "");
    skillLines.push("| Field | Values |");
    skillLines.push("|-------|--------|");
    for (const f of enumFields) {
      let vals: string[];
      try {
        vals = JSON.parse(f.enum_values!);
      } catch {
        vals = [f.enum_values!];
      }
      const display =
        vals.length > 10
          ? vals.slice(0, 10).map((v) => `\`${v}\``).join(", ") +
            ` ... (${vals.length} total)`
          : vals.map((v) => `\`${v}\``).join(", ");
      skillLines.push(`| \`${f.name}\` | ${display} |`);
    }
    skillLines.push("");
  }

  skillLines.push(
    `See [FIELD-REFERENCE.md](FIELD-REFERENCE.md) for the complete field listing.`,
    ""
  );

  fs.writeFileSync(path.join(entityDir, "SKILL.md"), skillLines.join("\n"));

  // --- FIELD-REFERENCE.md ---
  const refLines: string[] = [
    `# ${entity.name} — Field Reference`,
    "",
    `> ${fields.length} fields total`,
    "",
    "| # | Field | Type | Req | Key | Description |",
    "|---|-------|------|-----|-----|-------------|",
  ];

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const req = f.is_required ? "Y" : "";
    const key = f.is_key ? "PK" : "";
    const descEscaped = (f.description || "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
    refLines.push(
      `| ${i + 1} | \`${f.name}\` | ${f.data_type || "—"} | ${req} | ${key} | ${descEscaped} |`
    );
  }
  refLines.push("");

  // Enum detail section
  if (enumFields.length > 0) {
    refLines.push("## Enum Values", "");
    for (const f of enumFields) {
      let vals: string[];
      try {
        vals = JSON.parse(f.enum_values!);
      } catch {
        vals = [f.enum_values!];
      }
      refLines.push(`### ${f.name}`, "");
      refLines.push("```");
      refLines.push(vals.join(", "));
      refLines.push("```", "");
    }
  }

  fs.writeFileSync(
    path.join(entityDir, "FIELD-REFERENCE.md"),
    refLines.join("\n")
  );

  console.log(
    `  Generated ${slug}/ (${fields.length} fields, ${enumFields.length} enums)`
  );
}

// ─── Step 3: Update top-level SKILL.md table listing ───────────

const realTableRows = entities
  .map((e) => {
    const slug = slugify(e.name);
    const desc =
      e.description ||
      ENTITY_DESCRIPTIONS[e.name] ||
      "";
    const shortDesc = desc.length > 80 ? desc.slice(0, 77) + "..." : desc;
    return `| ${e.name} | ${e.field_count} | ${shortDesc} | [tables/${slug}/](tables/${slug}/SKILL.md) |`;
  })
  .join("\n");

const newSkillMd = `# ServiceMac ACDC Domain

ServiceMac's ACDC extract is the source schema for mapping to VDS. This skill covers table structures, field definitions, and data patterns.

## Source Schema Assets

| Asset | Entities | Total Fields |
|-------|----------|-------------|
| ACDC | ${entities.filter((e) => e.asset_name === "ACDC").length} | ${entities.filter((e) => e.asset_name === "ACDC").reduce((s, e) => s + e.field_count, 0)} |
| BankruptcyHistory Schema | 1 | ${entities.find((e) => e.name === "BankruptcyHistory")?.field_count ?? 0} |
| BankruptcyLedger Schema | 1 | ${entities.find((e) => e.name === "BankruptcyLedger")?.field_count ?? 0} |
| MBSPOOL Fields | 1 | ${entities.find((e) => e.name === "MBSPOOL Fields")?.field_count ?? 0} |

## Tables

| Table | Fields | Description | Skill |
|-------|--------|-------------|-------|
${realTableRows}

## Domain Skills

| Domain | Description | Skill |
|--------|-------------|-------|
| Loss Mitigation | Deferrals, forbearance, modifications | [domains/loss-mitigation/](domains/loss-mitigation/SKILL.md) |
| Foreclosure | FORE workstation and sale tracking | [domains/foreclosure/](domains/foreclosure/SKILL.md) |
| Bankruptcy | Chapter 7/13 via BANK workstation | [domains/bankruptcy/](domains/bankruptcy/SKILL.md) |
| Borrower & Parties | Multi-borrower handling | [domains/borrower-and-parties/](domains/borrower-and-parties/SKILL.md) |

## Resources

| Resource | Description |
|----------|-------------|
| [TABLE-RELATIONSHIPS.md](TABLE-RELATIONSHIPS.md) | Table joins, keys, and ERD |
| [MAPPING-DECISIONS.md](MAPPING-DECISIONS.md) | Key decisions from SM-Valon sessions |
| [SCHEMA-STRUCTURE.md](SCHEMA-STRUCTURE.md) | Ocean ACDC Schema xlsx structure |
| [STATE-ESCROW-MONTHS.md](STATE-ESCROW-MONTHS.md) | State escrow analysis months |
| [STEP-CODE-SYSTEM-GUIDE.md](STEP-CODE-SYSTEM-GUIDE.md) | Step code system guide |
`;

fs.writeFileSync(path.join(SM_ROOT, "SKILL.md"), newSkillMd);
console.log("\nRegenerated top-level SKILL.md");

// ─── Step 4: Update TABLE-RELATIONSHIPS.md ─────────────────────
// Keep only tables that actually exist in the DB

const realEntityNames = new Set(entities.map((e) => e.name));
const trPath = path.join(SM_ROOT, "TABLE-RELATIONSHIPS.md");
if (fs.existsSync(trPath)) {
  let trContent = fs.readFileSync(trPath, "utf-8");

  // Add a warning header
  const warningBlock = `> **Note**: This document only covers tables that exist in the ACDC schema.
> Real tables: ${[...realEntityNames].join(", ")}

`;
  // Insert warning after the first heading
  trContent = trContent.replace(
    /^(# .+\n\n)/,
    `$1${warningBlock}`
  );

  fs.writeFileSync(trPath, trContent);
  console.log("Updated TABLE-RELATIONSHIPS.md with real-table warning");
}

// ─── Step 5: Re-import ServiceMac contexts (INSERT OR REPLACE) ──
interface ContextDoc {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  content: string;
  tags: string[];
  importSource: string;
  metadata?: Record<string, unknown> | null;
}

const docs: ContextDoc[] = [];

// 5a. Top-level markdown files
const topLevelFiles = fs
  .readdirSync(SM_ROOT)
  .filter(
    (f) => f.endsWith(".md") && fs.statSync(path.join(SM_ROOT, f)).isFile()
  );

for (const file of topLevelFiles) {
  const content = stripFrontmatter(
    fs.readFileSync(path.join(SM_ROOT, file), "utf-8")
  );
  if (file === "SKILL.md") {
    docs.push({
      id: deterministicId("servicemac-domain/"),
      name: "ServiceMac > Overview",
      category: "schema",
      subcategory: "data_dictionary",
      content,
      tags: ["servicemac", "overview"],
      importSource: "servicemac-domain/",
    });
  } else {
    const label = slugToLabel(file);
    docs.push({
      id: deterministicId(`servicemac-domain/${file}`),
      name: `ServiceMac > ${label}`,
      category: "schema",
      subcategory: file.includes("DECISION") ? "field_spec" : "data_dictionary",
      content,
      tags: ["servicemac", file.replace(/\.md$/i, "").toLowerCase()],
      importSource: `servicemac-domain/${file}`,
    });
  }
}

// 5b. Table folders (newly generated)
const tableFolders = fs
  .readdirSync(TABLES_DIR)
  .filter((d) => fs.statSync(path.join(TABLES_DIR, d)).isDirectory());

for (const folder of tableFolders) {
  const folderPath = path.join(TABLES_DIR, folder);
  const mdFiles = fs
    .readdirSync(folderPath)
    .filter((f) => f.endsWith(".md"))
    .sort((a, b) => {
      if (a === "SKILL.md") return -1;
      if (b === "SKILL.md") return 1;
      return a.localeCompare(b);
    });

  const sections: string[] = [];
  for (const file of mdFiles) {
    const raw = stripFrontmatter(
      fs.readFileSync(path.join(folderPath, file), "utf-8")
    );
    if (file === "SKILL.md") {
      sections.push(raw);
    } else {
      const sectionLabel = slugToLabel(file);
      sections.push(`\n---\n\n## ${sectionLabel}\n\n${raw}`);
    }
  }

  const content = sections.join("\n");
  const label = slugToLabel(folder);

  docs.push({
    id: deterministicId(`servicemac-domain/tables/${folder}`),
    name: `ServiceMac > Tables > ${label}`,
    category: "schema",
    subcategory: "data_dictionary",
    content,
    tags: ["servicemac", "table", folder],
    importSource: `servicemac-domain/tables/${folder}`,
  });
}

// 5c. Domain folders
const domainsDir = path.join(SM_ROOT, "domains");
if (fs.existsSync(domainsDir)) {
  const domainFolders = fs
    .readdirSync(domainsDir)
    .filter((d) => fs.statSync(path.join(domainsDir, d)).isDirectory());

  for (const folder of domainFolders) {
    const folderPath = path.join(domainsDir, folder);
    const mdFiles = fs
      .readdirSync(folderPath)
      .filter((f) => f.endsWith(".md"))
      .sort((a, b) => {
        if (a === "SKILL.md") return -1;
        if (b === "SKILL.md") return 1;
        return a.localeCompare(b);
      });

    const sections: string[] = [];
    for (const file of mdFiles) {
      const raw = stripFrontmatter(
        fs.readFileSync(path.join(folderPath, file), "utf-8")
      );
      if (file === "SKILL.md") {
        sections.push(raw);
      } else {
        const sectionLabel = slugToLabel(file);
        sections.push(`\n---\n\n## ${sectionLabel}\n\n${raw}`);
      }
    }

    const content = sections.join("\n");
    const label = slugToLabel(folder);

    docs.push({
      id: deterministicId(`servicemac-domain/domains/${folder}`),
      name: `ServiceMac > Domains > ${label}`,
      category: "schema",
      subcategory: "data_dictionary",
      content,
      tags: ["servicemac", "domain", folder],
      importSource: `servicemac-domain/domains/${folder}`,
    });
  }
}

// 5d. Enums
const ENUM_TO_TABLE_NAMES: Record<string, string[]> = {
  ARM: ["Arm"],
  DEFAULTWORKSTATIONS: ["Default Workstations"],
  FAIRLENDING: ["Borrower Demographics"],
  HAZARDINSURANCE: ["Hazard Insurance"],
  HELOC: ["HELOC"],
  HELOCSEGMENTS: ["HELOC Segments"],
  INVESTOR: ["Investor"],
  LETTER: ["Letter"],
  LOANINFO: ["Loan Info"],
  LOSSMITIGATION: ["Loss Mitigation"],
  STEP: ["Step"],
  STOPSFLAGSANDINDICATORS: ["Stops Flags Indicators"],
  TAX: ["Tax"],
  TRANSACTION: ["Transaction"],
};

const enumsDir = path.join(SM_ROOT, "enums");
if (fs.existsSync(enumsDir)) {
  const enumFiles = fs.readdirSync(enumsDir).filter((f) => f.endsWith(".md"));
  for (const file of enumFiles) {
    const content = stripFrontmatter(
      fs.readFileSync(path.join(enumsDir, file), "utf-8")
    );
    const label = slugToLabel(file);
    const extractKey = file.replace(/-ENUMS\.md$/i, "").toUpperCase();
    const sourceTables = ENUM_TO_TABLE_NAMES[extractKey] || [];
    docs.push({
      id: deterministicId(`servicemac-domain/enums/${file}`),
      name: `ServiceMac > Enums > ${label}`,
      category: "schema",
      subcategory: "enum_map",
      content,
      tags: ["servicemac", "enum"],
      importSource: `servicemac-domain/enums/${file}`,
      metadata:
        sourceTables.length > 0 ? { source_tables: sourceTables } : null,
    });
  }
}

// Insert all
const now = new Date().toISOString();
const stmt = db.prepare(`
  INSERT OR REPLACE INTO context (id, workspace_id, name, category, subcategory, content, content_format, token_count, tags, is_active, sort_order, import_source, metadata, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, ?, 1, 0, ?, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  for (const doc of docs) {
    const tokenCount = Math.ceil(doc.content.length / 4);
    const metadata = doc.metadata ? JSON.stringify(doc.metadata) : null;
    stmt.run(
      doc.id,
      WORKSPACE_ID,
      doc.name,
      doc.category,
      doc.subcategory,
      doc.content,
      tokenCount,
      JSON.stringify(doc.tags),
      doc.importSource,
      metadata,
      now,
      now
    );
  }
});

insertAll();

// ─── Summary ───────────────────────────────────────────────────

const byType = { topLevel: 0, tables: 0, domains: 0, enums: 0 };
for (const d of docs) {
  if (d.name.includes("> Tables >")) byType.tables++;
  else if (d.name.includes("> Domains >")) byType.domains++;
  else if (d.name.includes("> Enums >")) byType.enums++;
  else byType.topLevel++;
}

console.log(`\nImported ${docs.length} ServiceMac contexts:`);
console.log(`  Top-level docs: ${byType.topLevel}`);
console.log(`  Table docs:     ${byType.tables}`);
console.log(`  Domain docs:    ${byType.domains}`);
console.log(`  Enum docs:      ${byType.enums}`);

const total = db
  .prepare("SELECT COUNT(*) as cnt FROM context")
  .get() as { cnt: number };
console.log(`\nTotal contexts in DB: ${total.cnt}`);

db.close();
console.log("\nDone.");
