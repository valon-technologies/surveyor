/**
 * Unified context seeder — imports all context from mapping-engine into Surveyor's SQLite DB.
 *
 * Categories imported:
 *   1. VDS entities (skills/vds-entities/)
 *   2. ServiceMac domain (skills/servicemac-domain/)
 *   3. Mortgage domain (skills/mortgage-domain/)
 *   4. ACDC schemas (cache/bq_schema/)
 *   5. Distilled learnings (learnings/distilled-learnings.md)
 *   6. M1 SOT YAMLs (evaluations/yaml-v7-full-v3/)
 *   7. Transcripts (skills-sanitized/servicemac-m1/transcripts/)
 *   8. Step codes (inline data)
 *
 * Usage:
 *   npx tsx scripts/seed-from-mapping-engine.ts [--mapping-engine-dir /path/to/mapping-engine]
 *
 * Replaces the individual import-*.ts scripts which pointed to Grant's local machine.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { STEP_CODE_DOCS } from "./data/step-codes-data";

// ── CLI args ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const meIdx = args.indexOf("--mapping-engine-dir");
const ME_ROOT = meIdx !== -1 && args[meIdx + 1]
  ? path.resolve(args[meIdx + 1])
  : "/Users/rob/code/mapping-engine";

if (!fs.existsSync(ME_ROOT)) {
  console.error(`mapping-engine dir not found: ${ME_ROOT}`);
  process.exit(1);
}

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const WORKSPACE_ID = (
  db.prepare("SELECT id FROM workspace LIMIT 1").get() as { id: string }
).id;

if (!WORKSPACE_ID) {
  console.error("No workspace found in DB");
  process.exit(1);
}

console.log(`Seeding from: ${ME_ROOT}`);
console.log(`Workspace:    ${WORKSPACE_ID}\n`);

// ── Shared utilities ────────────────────────────────────────────

const ACRONYMS: Record<string, string> = {
  cfpb: "CFPB", fcra: "FCRA", fdcpa: "FDCPA", fincen: "FinCEN",
  glba: "GLBA", hpa: "HPA", scra: "SCRA", tcpa: "TCPA",
  udaap: "UDAAP", ofac: "OFAC", fha: "FHA", usda: "USDA",
  va: "VA", gse: "GSE", mbs: "MBS", mers: "MERS", cwcot: "CWCOT",
  arm: "ARM", heloc: "HELOC", mi: "MI", pmi: "PMI", dc: "DC",
  reo: "REO", hud: "HUD", respa: "RESPA", tila: "TILA",
  qc: "QC", ach: "ACH", api: "API", llc: "LLC", lp: "LP",
  poc: "POC", sm: "SM", vds: "VDS", acdc: "ACDC",
  sql: "SQL", s2mr: "S2MR", dq: "DQ",
};

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

function readMd(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

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

// ── Upsert helper ───────────────────────────────────────────────

const upsertStmt = db.prepare(`
  INSERT OR REPLACE INTO context (
    id, workspace_id, name, category, subcategory, content, content_format,
    token_count, tags, is_active, sort_order, import_source, metadata,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, ?, 1, 0, ?, ?, ?, ?)
`);

const now = new Date().toISOString();
const counts: Record<string, number> = {};

function upsertDocs(label: string, docs: ContextDoc[]): void {
  const txn = db.transaction(() => {
    for (const doc of docs) {
      const tokenCount = Math.ceil(doc.content.length / 4);
      const metadata = doc.metadata ? JSON.stringify(doc.metadata) : null;
      upsertStmt.run(
        doc.id, WORKSPACE_ID, doc.name, doc.category, doc.subcategory,
        doc.content, tokenCount, JSON.stringify(doc.tags),
        doc.importSource, metadata, now, now,
      );
    }
  });
  txn();
  counts[label] = docs.length;
  console.log(`  ${label}: ${docs.length} docs`);
}

// ── Recursive topic discovery (VDS + Mortgage) ──────────────────

interface TopicFolder {
  relativePath: string;
  absPath: string;
  nameParts: string[];
  skillMd: string | null;
  detailFiles: string[];
  tags: string[];
}

function discoverTopicFolders(dir: string, pathParts: string[] = [], tagPrefix: string[] = []): TopicFolder[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders: TopicFolder[] = [];

  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
  const hasSkillMd = mdFiles.includes("SKILL.md");
  const detailFiles = mdFiles.filter((f) => f !== "SKILL.md");

  if (hasSkillMd || detailFiles.length > 0) {
    folders.push({
      relativePath: pathParts.join("/"),
      absPath: dir,
      nameParts: [...pathParts],
      skillMd: hasSkillMd ? path.join(dir, "SKILL.md") : null,
      detailFiles: detailFiles.map((f) => path.join(dir, f)),
      tags: [...tagPrefix, ...pathParts],
    });
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      folders.push(
        ...discoverTopicFolders(path.join(dir, entry.name), [...pathParts, entry.name], tagPrefix)
      );
    }
  }

  return folders;
}

function mergeTopicContent(topic: TopicFolder): string {
  const parts: string[] = [];
  if (topic.skillMd) {
    parts.push(stripFrontmatter(readMd(topic.skillMd)));
  }
  for (const detailFile of topic.detailFiles.sort()) {
    const fileName = path.basename(detailFile, ".md");
    const content = stripFrontmatter(readMd(detailFile));
    parts.push(`\n---\n\n## ${slugToLabel(fileName)}\n\n${content}`);
  }
  return parts.join("\n\n");
}

// ═══════════════════════════════════════════════════════════════
// 1. VDS ENTITIES
// ═══════════════════════════════════════════════════════════════

function importVdsEntities(): ContextDoc[] {
  const root = path.join(ME_ROOT, "skills/vds-entities");
  if (!fs.existsSync(root)) { console.warn("  Skipping VDS entities (dir not found)"); return []; }

  const topics = discoverTopicFolders(root, [], ["vds"]);
  const docs: ContextDoc[] = [];

  for (const topic of topics) {
    const content = mergeTopicContent(topic);
    if (!content.trim()) continue;

    const name = topic.nameParts.length > 0
      ? "VDS > " + topic.nameParts.map(slugToLabel).join(" > ")
      : "VDS > Overview";

    docs.push({
      id: deterministicId(`vds-entities/${topic.relativePath}`),
      name,
      category: "schema",
      subcategory: "data_dictionary",
      content,
      tags: topic.tags,
      importSource: `vds-entities/${topic.relativePath}`,
    });
  }

  return docs;
}

// ═══════════════════════════════════════════════════════════════
// 2. SERVICEMAC DOMAIN
// ═══════════════════════════════════════════════════════════════

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

function importServicemacDomain(): ContextDoc[] {
  const root = path.join(ME_ROOT, "skills/servicemac-domain");
  if (!fs.existsSync(root)) { console.warn("  Skipping ServiceMac domain (dir not found)"); return []; }

  const docs: ContextDoc[] = [];

  // Top-level markdown files
  const topLevelFiles = fs.readdirSync(root)
    .filter((f) => f.endsWith(".md") && fs.statSync(path.join(root, f)).isFile());

  for (const file of topLevelFiles) {
    const content = stripFrontmatter(readMd(path.join(root, file)));
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

  // Table folders
  const tablesDir = path.join(root, "tables");
  if (fs.existsSync(tablesDir)) {
    const tableFolders = fs.readdirSync(tablesDir)
      .filter((d) => fs.statSync(path.join(tablesDir, d)).isDirectory());

    for (const folder of tableFolders) {
      const folderPath = path.join(tablesDir, folder);
      const mdFiles = fs.readdirSync(folderPath)
        .filter((f) => f.endsWith(".md"))
        .sort((a, b) => {
          if (a === "SKILL.md") return -1;
          if (b === "SKILL.md") return 1;
          return a.localeCompare(b);
        });

      const sections: string[] = [];
      for (const file of mdFiles) {
        const raw = stripFrontmatter(readMd(path.join(folderPath, file)));
        if (file === "SKILL.md") {
          sections.push(raw);
        } else {
          sections.push(`\n---\n\n## ${slugToLabel(file)}\n\n${raw}`);
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
  }

  // Domain folders
  const domainsDir = path.join(root, "domains");
  if (fs.existsSync(domainsDir)) {
    const domainFolders = fs.readdirSync(domainsDir)
      .filter((d) => fs.statSync(path.join(domainsDir, d)).isDirectory());

    for (const folder of domainFolders) {
      const folderPath = path.join(domainsDir, folder);
      const mdFiles = fs.readdirSync(folderPath)
        .filter((f) => f.endsWith(".md"))
        .sort((a, b) => {
          if (a === "SKILL.md") return -1;
          if (b === "SKILL.md") return 1;
          return a.localeCompare(b);
        });

      const sections: string[] = [];
      for (const file of mdFiles) {
        const raw = stripFrontmatter(readMd(path.join(folderPath, file)));
        if (file === "SKILL.md") {
          sections.push(raw);
        } else {
          sections.push(`\n---\n\n## ${slugToLabel(file)}\n\n${raw}`);
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

  // Enums (may not exist in mapping-engine)
  const enumsDir = path.join(root, "enums");
  if (fs.existsSync(enumsDir)) {
    const enumFiles = fs.readdirSync(enumsDir).filter((f) => f.endsWith(".md"));
    for (const file of enumFiles) {
      const content = stripFrontmatter(readMd(path.join(enumsDir, file)));
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
        metadata: sourceTables.length > 0 ? { source_tables: sourceTables } : null,
      });
    }
  }

  return docs;
}

// ═══════════════════════════════════════════════════════════════
// 3. MORTGAGE DOMAIN
// ═══════════════════════════════════════════════════════════════

function importMortgageDomain(): ContextDoc[] {
  const root = path.join(ME_ROOT, "skills/mortgage-domain");
  if (!fs.existsSync(root)) { console.warn("  Skipping mortgage domain (dir not found)"); return []; }

  const topics = discoverTopicFolders(root, [], []);
  const docs: ContextDoc[] = [];

  for (const topic of topics) {
    const content = mergeTopicContent(topic);
    if (!content.trim()) continue;

    const name = topic.nameParts.length > 0
      ? "Mortgage Servicing > " + topic.nameParts.map(slugToLabel).join(" > ")
      : "Mortgage Servicing > Overview";

    const relativePath = path.relative(root, topic.absPath);

    docs.push({
      id: deterministicId(`mortgage-domain/${relativePath}`),
      name,
      category: "foundational",
      subcategory: "domain_knowledge",
      content,
      tags: topic.nameParts.length > 0 ? topic.nameParts : ["mortgage-domain"],
      importSource: `mortgage-domain/${relativePath}`,
    });
  }

  return docs;
}

// ═══════════════════════════════════════════════════════════════
// 4. ACDC SCHEMAS (BigQuery table schemas)
// ═══════════════════════════════════════════════════════════════

function importAcdcSchemas(): ContextDoc[] {
  const schemaDir = path.join(ME_ROOT, "cache/bq_schema");
  if (!fs.existsSync(schemaDir)) { console.warn("  Skipping ACDC schemas (dir not found)"); return []; }

  const jsonFiles = fs.readdirSync(schemaDir)
    .filter((f) => f.endsWith(".json") && f !== "summary.json");

  const docs: ContextDoc[] = [];

  for (const file of jsonFiles) {
    const tableName = path.basename(file, ".json");
    const raw = JSON.parse(fs.readFileSync(path.join(schemaDir, file), "utf-8"));
    const meta = raw._meta || {};
    const fields: { column_name: string; data_type: string; is_nullable: string }[] = raw.fields || [];

    // Format as readable schema doc
    const lines: string[] = [
      `# ACDC Schema: ${tableName}`,
      "",
      `> Source: \`${meta.project || "service-mac-prod"}.${meta.dataset || "raw_acdc_m1"}.${tableName}\``,
      `> Refreshed: ${meta.refreshed_at || "unknown"}`,
      `> Columns: ${fields.length}`,
      "",
      "| Column | Type | Nullable |",
      "|--------|------|----------|",
    ];

    for (const f of fields) {
      lines.push(`| ${f.column_name} | ${f.data_type} | ${f.is_nullable} |`);
    }

    const content = lines.join("\n");

    docs.push({
      id: deterministicId(`acdc-schema/${tableName}`),
      name: `ACDC Schema > ${tableName}`,
      category: "schema",
      subcategory: "data_dictionary",
      content,
      tags: ["acdc", "schema", tableName.toLowerCase()],
      importSource: `acdc-schema/${tableName}`,
    });
  }

  return docs;
}

// ═══════════════════════════════════════════════════════════════
// 5. DISTILLED LEARNINGS
// ═══════════════════════════════════════════════════════════════

function importDistilledLearnings(): ContextDoc[] {
  const filePath = path.join(ME_ROOT, "learnings/distilled-learnings.md");
  if (!fs.existsSync(filePath)) { console.warn("  Skipping distilled learnings (file not found)"); return []; }

  const content = stripFrontmatter(readMd(filePath));

  return [{
    id: deterministicId("learnings/distilled-learnings"),
    name: "Mapping > Distilled Learnings",
    category: "foundational",
    subcategory: "domain_knowledge",
    content,
    tags: ["learnings", "distilled", "patterns"],
    importSource: "learnings/distilled-learnings",
  }];
}

// ═══════════════════════════════════════════════════════════════
// 6. M1 SOT YAMLs (ground truth reference mappings)
// ═══════════════════════════════════════════════════════════════

function importSotYamls(): ContextDoc[] {
  const evalDir = path.join(ME_ROOT, "evaluations/yaml-v7-full-v3");
  if (!fs.existsSync(evalDir)) { console.warn("  Skipping M1 SOT YAMLs (dir not found)"); return []; }

  const jsonFiles = fs.readdirSync(evalDir)
    .filter((f) => f.endsWith(".json") && f !== "summary.json");

  const docs: ContextDoc[] = [];

  for (const file of jsonFiles) {
    const entityName = path.basename(file, ".json");
    const raw = JSON.parse(fs.readFileSync(path.join(evalDir, file), "utf-8"));

    // Format field evaluations as a reference doc
    const lines: string[] = [
      `# SOT Reference: ${entityName}`,
      "",
      `> M1 ground truth evaluation for \`${entityName}\``,
      "",
    ];

    const evals = raw.field_evaluations || {};
    const fieldNames = Object.keys(evals);

    if (fieldNames.length > 0) {
      lines.push("| Field | SOT Sources | Source Match | Transform Match |");
      lines.push("|-------|-------------|-------------|-----------------|");

      for (const fieldName of fieldNames) {
        const fe = evals[fieldName];
        const sotSources = (fe.sot_sources || []).join(", ");
        lines.push(
          `| ${fieldName} | ${sotSources} | ${fe.source_match || "—"} | ${fe.transform_match || "—"} |`
        );
      }

      // Add detailed mappings as expandable sections
      lines.push("");
      lines.push("## Field Details");
      lines.push("");

      for (const fieldName of fieldNames) {
        const fe = evals[fieldName];
        lines.push(`### ${fieldName}`);
        if (fe.sot_summary) {
          lines.push(`**SOT**: ${fe.sot_summary}`);
        }
        if (fe.candidate_summary) {
          lines.push(`**Generated**: ${fe.candidate_summary}`);
        }
        if (fe.explanation) {
          lines.push(`**Gap**: ${fe.explanation}`);
        }
        lines.push("");
      }
    }

    const content = lines.join("\n");

    docs.push({
      id: deterministicId(`sot/${entityName}`),
      name: `SOT > ${entityName} (M1)`,
      category: "schema",
      subcategory: "entity_knowledge",
      content,
      tags: ["sot", "m1", "reference", entityName],
      importSource: `sot/${entityName}`,
    });
  }

  return docs;
}

// ═══════════════════════════════════════════════════════════════
// 7. TRANSCRIPTS
// ═══════════════════════════════════════════════════════════════

function importTranscripts(): ContextDoc[] {
  const transcriptsDir = path.join(ME_ROOT, "skills-sanitized/servicemac-m1/transcripts");
  if (!fs.existsSync(transcriptsDir)) { console.warn("  Skipping transcripts (dir not found)"); return []; }

  const TRANSCRIPT_NAMES: Record<string, string> = {
    "day-1-morning-mapping.md": "ServiceMac > Day 1 Morning — Loan, Escrow, Investor",
    "day-1-afternoon-mapping.md": "ServiceMac > Day 1 Afternoon — Cash, Collections, Loss Mit",
    "day-2-morning-mapping.md": "ServiceMac > Day 2 Morning — Foreclosure, Bankruptcy, Claims",
    "day-2-afternoon-mapping.md": "ServiceMac > Day 2 Afternoon — REO, Makeup Sessions",
    "DISTILLED-TRANSCRIPT-NOTES.md": "ServiceMac > Distilled Transcript Notes",
  };

  const docs: ContextDoc[] = [];
  const files = fs.readdirSync(transcriptsDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const content = readMd(path.join(transcriptsDir, file)).trim();
    const name = TRANSCRIPT_NAMES[file] || `ServiceMac > Transcript > ${slugToLabel(file)}`;

    docs.push({
      id: deterministicId(`transcript/${file}`),
      name,
      category: "adhoc",
      subcategory: "transcript",
      content,
      tags: ["servicemac", "transcript", "mapping-session"],
      importSource: `servicemac-m1/transcripts/${file}`,
    });
  }

  return docs;
}

// ═══════════════════════════════════════════════════════════════
// 8. STEP CODES (inline data from step-codes-data.ts)
// ═══════════════════════════════════════════════════════════════

function importStepCodes(): ContextDoc[] {
  return STEP_CODE_DOCS.map((doc) => ({
    id: deterministicId(`context:${doc.name}`),
    name: doc.name,
    category: "schema",
    subcategory: "data_dictionary",
    content: doc.content,
    tags: doc.tags,
    importSource: `step-codes/${doc.name}`,
  }));
}

// ═══════════════════════════════════════════════════════════════
// RUN ALL IMPORTS
// ═══════════════════════════════════════════════════════════════

console.log("Importing context categories:\n");

upsertDocs("VDS entities", importVdsEntities());
upsertDocs("ServiceMac domain", importServicemacDomain());
upsertDocs("Mortgage domain", importMortgageDomain());
upsertDocs("ACDC schemas", importAcdcSchemas());
upsertDocs("Distilled learnings", importDistilledLearnings());
upsertDocs("M1 SOT YAMLs", importSotYamls());
upsertDocs("Transcripts", importTranscripts());
upsertDocs("Step codes", importStepCodes());

// ── FTS5 refresh (if table exists) ──────────────────────────────

try {
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='context_fts'"
  ).get();

  if (ftsExists) {
    console.log("\nRefreshing FTS5 index...");
    db.prepare("DELETE FROM context_fts").run();
    db.prepare(`
      INSERT INTO context_fts (context_id, workspace_id, name, content, tags)
      SELECT id, workspace_id, name, content,
        (SELECT GROUP_CONCAT(value, ' ') FROM json_each(tags))
      FROM context WHERE is_active = 1
    `).run();
    console.log("  FTS5 index refreshed.");
  }
} catch {
  // FTS5 table may not exist — that's fine
}

// ── Summary ─────────────────────────────────────────────────────

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const dbTotal = (db.prepare("SELECT COUNT(*) as cnt FROM context WHERE is_active = 1").get() as { cnt: number }).cnt;
const dbTokens = (db.prepare("SELECT SUM(token_count) as t FROM context WHERE is_active = 1").get() as { t: number }).t;

console.log(`\n${"═".repeat(50)}`);
console.log(`Imported: ${total} context docs`);
console.log(`DB total: ${dbTotal} active docs, ~${Math.round(dbTokens / 1000)}K tokens`);
console.log(`${"═".repeat(50)}`);

db.close();
