/**
 * Import ServiceMac domain skills as schema context documents.
 *
 * Structure:
 *   - Top-level docs → "ServiceMac > {DocTitle}"
 *   - Table folders  → "ServiceMac > Tables > {TableName}" (merged SKILL.md + resources)
 *   - Domain folders → "ServiceMac > Domains > {DomainName}" (merged SKILL.md + resources)
 *   - Enums          → "ServiceMac > Enums > {EnumName}"
 *
 * Usage: npx tsx scripts/import-servicemac-domain.ts
 */

import postgres from "postgres";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import "dotenv/config";

const SM_ROOT = "/Users/grantlee/Dev/mapping-skills/.claude/skills/servicemac-domain";
const WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });

// --- Acronym-aware label conversion ---
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
}

const docs: ContextDoc[] = [];

// --- 1. Top-level markdown files ---
const topLevelFiles = fs.readdirSync(SM_ROOT)
  .filter((f) => f.endsWith(".md") && fs.statSync(path.join(SM_ROOT, f)).isFile());

for (const file of topLevelFiles) {
  if (file === "SKILL.md") {
    // Root SKILL.md → overview doc
    const content = stripFrontmatter(readMd(path.join(SM_ROOT, file)));
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
    const content = stripFrontmatter(readMd(path.join(SM_ROOT, file)));
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

// --- 2. Table folders (merge SKILL.md + resource files) ---
const tablesDir = path.join(SM_ROOT, "tables");
if (fs.existsSync(tablesDir)) {
  const tableFolders = fs.readdirSync(tablesDir)
    .filter((d) => fs.statSync(path.join(tablesDir, d)).isDirectory());

  for (const folder of tableFolders) {
    const folderPath = path.join(tablesDir, folder);
    const mdFiles = fs.readdirSync(folderPath)
      .filter((f) => f.endsWith(".md"))
      .sort((a, b) => {
        // SKILL.md first, then alphabetical
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
}

// --- 3. Domain folders (merge SKILL.md + resource files) ---
const domainsDir = path.join(SM_ROOT, "domains");
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

// --- 4. Enums ---
const enumsDir = path.join(SM_ROOT, "enums");
if (fs.existsSync(enumsDir)) {
  const enumFiles = fs.readdirSync(enumsDir).filter((f) => f.endsWith(".md"));
  for (const file of enumFiles) {
    const content = stripFrontmatter(readMd(path.join(enumsDir, file)));
    const label = slugToLabel(file);
    docs.push({
      id: deterministicId(`servicemac-domain/enums/${file}`),
      name: `ServiceMac > Enums > ${label}`,
      category: "schema",
      subcategory: "enum_map",
      content,
      tags: ["servicemac", "enum"],
      importSource: `servicemac-domain/enums/${file}`,
    });
  }
}

// --- Insert ---
async function main() {
  const now = new Date().toISOString();

  await client.begin(async (tx) => {
    for (const doc of docs) {
      const tokenCount = Math.ceil(doc.content.length / 4);
      await tx`
        INSERT INTO context (id, workspace_id, name, category, subcategory, content, content_format, token_count, tags, is_active, sort_order, import_source, created_at, updated_at)
        VALUES (${doc.id}, ${WORKSPACE_ID}, ${doc.name}, ${doc.category}, ${doc.subcategory},
                ${doc.content}, 'markdown', ${tokenCount}, ${JSON.stringify(doc.tags)},
                1, 0, ${doc.importSource}, ${now}, ${now})
        ON CONFLICT (id) DO NOTHING
      `;
    }
  });

  console.log(`Imported ${docs.length} ServiceMac domain contexts:`);
  const byType = { topLevel: 0, tables: 0, domains: 0, enums: 0 };
  for (const d of docs) {
    if (d.name.includes("> Tables >")) byType.tables++;
    else if (d.name.includes("> Domains >")) byType.domains++;
    else if (d.name.includes("> Enums >")) byType.enums++;
    else byType.topLevel++;
  }
  console.log(`  Top-level docs: ${byType.topLevel}`);
  console.log(`  Table docs:     ${byType.tables}`);
  console.log(`  Domain docs:    ${byType.domains}`);
  console.log(`  Enum docs:      ${byType.enums}`);

  const total = (await client`SELECT COUNT(*) as cnt FROM context`)[0] as { cnt: number };
  console.log(`\nTotal contexts in DB: ${total.cnt}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
