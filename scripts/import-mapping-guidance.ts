/**
 * Import mapping guidance, patterns, decisions, and entity Q&A as context documents.
 *
 * Sources:
 *   - CLAUDE.md → "Mapping > Critical Rules and Workflow"
 *   - mappings/MAPPING-PATTERNS.md → "Mapping > Patterns"
 *   - servicemac-domain/MAPPING-DECISIONS.md → already imported by servicemac importer
 *   - MIGRATION-SCOPE.md → "Mapping > Migration Scope"
 *   - data-mapping-plan.md → "Mapping > Mapping Plan"
 *   - UNMAPPED-FIELDS-REVIEW.md → "Mapping > Unmapped Fields Review"
 *   - mappings/MAPPING-STATUS.md → "Mapping > Status"
 *   - Entity Q&A → "Mapping Q&A > {Entity} > {Open|Resolved}"
 *   - Entity feedback → "Mapping Q&A > {Entity} > Feedback"
 *
 * Usage: npx tsx scripts/import-mapping-guidance.ts
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const SKILLS_ROOT = "/Users/grantlee/Dev/mapping-skills";
const WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";

const db = new Database(DB_PATH);

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

function readMdSafe(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return stripFrontmatter(fs.readFileSync(filePath, "utf-8"));
}

interface ContextDoc {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  content: string;
  tags: string[];
  importSource: string;
}

const docs: ContextDoc[] = [];

// --- 1. Top-level methodology docs ---
const methodologyDocs: { file: string; name: string; tags: string[] }[] = [
  {
    file: "CLAUDE.md",
    name: "Mapping > Critical Rules and Workflow",
    tags: ["methodology", "critical-rules", "workflow"],
  },
  {
    file: "MIGRATION-SCOPE.md",
    name: "Mapping > Migration Scope",
    tags: ["methodology", "migration-scope", "tiers"],
  },
  {
    file: "data-mapping-plan.md",
    name: "Mapping > Mapping Plan",
    tags: ["methodology", "mapping-plan", "validation"],
  },
  {
    file: "UNMAPPED-FIELDS-REVIEW.md",
    name: "Mapping > Unmapped Fields Review",
    tags: ["methodology", "unmapped-fields", "review"],
  },
];

for (const doc of methodologyDocs) {
  const content = readMdSafe(path.join(SKILLS_ROOT, doc.file));
  if (!content) {
    console.warn(`  Skipped ${doc.file} (not found)`);
    continue;
  }
  docs.push({
    id: deterministicId(`methodology/${doc.file}`),
    name: doc.name,
    category: "foundational",
    subcategory: "business_rules",
    content,
    tags: doc.tags,
    importSource: `methodology/${doc.file}`,
  });
}

// --- 2. Mapping patterns and status ---
const mappingsDocs: { file: string; name: string; subcategory: string; tags: string[] }[] = [
  {
    file: "mappings/MAPPING-PATTERNS.md",
    name: "Mapping > Patterns",
    subcategory: "business_rules",
    tags: ["methodology", "patterns", "sql-templates"],
  },
  {
    file: "mappings/MAPPING-STATUS.md",
    name: "Mapping > Status",
    subcategory: "business_rules",
    tags: ["methodology", "status", "progress"],
  },
];

for (const doc of mappingsDocs) {
  const content = readMdSafe(path.join(SKILLS_ROOT, doc.file));
  if (!content) {
    console.warn(`  Skipped ${doc.file} (not found)`);
    continue;
  }
  docs.push({
    id: deterministicId(`methodology/${doc.file}`),
    name: doc.name,
    category: "foundational",
    subcategory: doc.subcategory,
    content,
    tags: doc.tags,
    importSource: `methodology/${doc.file}`,
  });
}

// --- 3. Entity Q&A and feedback ---
const mappingsDir = path.join(SKILLS_ROOT, "mappings");
const entityFolders = fs.readdirSync(mappingsDir)
  .filter((d) => fs.statSync(path.join(mappingsDir, d)).isDirectory());

for (const entity of entityFolders) {
  const entityDir = path.join(mappingsDir, entity);
  const entityLabel = entity.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Open questions
  const openQ = readMdSafe(path.join(entityDir, "questions", "open.md"));
  if (openQ && openQ.length > 50) {
    docs.push({
      id: deterministicId(`qa/${entity}/open`),
      name: `Mapping Q&A > ${entityLabel} > Open Questions`,
      category: "adhoc",
      subcategory: "working_doc",
      content: openQ,
      tags: ["qa", "questions", "open", entity],
      importSource: `mappings/${entity}/questions/open.md`,
    });
  }

  // Resolved questions
  const resolvedQ = readMdSafe(path.join(entityDir, "questions", "resolved.md"));
  if (resolvedQ && resolvedQ.length > 50) {
    docs.push({
      id: deterministicId(`qa/${entity}/resolved`),
      name: `Mapping Q&A > ${entityLabel} > Resolved Questions`,
      category: "adhoc",
      subcategory: "working_doc",
      content: resolvedQ,
      tags: ["qa", "questions", "resolved", entity],
      importSource: `mappings/${entity}/questions/resolved.md`,
    });
  }

  // Feedback
  const feedback = readMdSafe(path.join(entityDir, "FEEDBACK.md"));
  if (feedback && feedback.length > 50) {
    docs.push({
      id: deterministicId(`qa/${entity}/feedback`),
      name: `Mapping Q&A > ${entityLabel} > Feedback`,
      category: "adhoc",
      subcategory: "working_doc",
      content: feedback,
      tags: ["qa", "feedback", entity],
      importSource: `mappings/${entity}/FEEDBACK.md`,
    });
  }

  // Entity README (foreclosure has one)
  const readme = readMdSafe(path.join(entityDir, "README.md"));
  if (readme && readme.length > 50) {
    docs.push({
      id: deterministicId(`qa/${entity}/readme`),
      name: `Mapping Q&A > ${entityLabel} > Overview`,
      category: "adhoc",
      subcategory: "working_doc",
      content: readme,
      tags: ["qa", "overview", entity],
      importSource: `mappings/${entity}/README.md`,
    });
  }
}

// --- Insert ---
const now = new Date().toISOString();
const stmt = db.prepare(`
  INSERT OR IGNORE INTO context (id, workspace_id, name, category, subcategory, content, content_format, token_count, tags, is_active, sort_order, import_source, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?, ?, 1, 0, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  for (const doc of docs) {
    const tokenCount = Math.ceil(doc.content.length / 4);
    stmt.run(
      doc.id, WORKSPACE_ID, doc.name, doc.category, doc.subcategory,
      doc.content, tokenCount, JSON.stringify(doc.tags),
      doc.importSource, now, now
    );
  }
});

insertAll();

console.log(`Imported ${docs.length} mapping guidance contexts:`);
const methodology = docs.filter((d) => d.name.startsWith("Mapping"));
const qa = docs.filter((d) => d.name.startsWith("Mapping Q&A"));
console.log(`  Methodology docs: ${methodology.length}`);
console.log(`  Q&A docs:         ${qa.length}`);

const total = db.prepare("SELECT COUNT(*) as cnt FROM context").get() as { cnt: number };
console.log(`\nTotal contexts in DB: ${total.cnt}`);

db.close();
