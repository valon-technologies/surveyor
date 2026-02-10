/**
 * Import VDS entity skills as schema/data_dictionary context documents.
 *
 * Each entity folder (with SKILL.md, FIELDS.md, ENUMS.md, MAPPING.md, etc.)
 * is merged into a single context doc named "VDS > Category > Entity".
 *
 * Usage: npx tsx scripts/import-vds-entities.ts
 */

import postgres from "postgres";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import "dotenv/config";

const VDS_ROOT = "/Users/grantlee/Dev/mapping-skills/.claude/skills/vds-entities";
const WORKSPACE_ID = "fbc37e23-39b4-4cdc-b162-f1f7d9772ab0";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });

function readMd(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end !== -1) {
      return content.slice(end + 3).trim();
    }
  }
  return content.trim();
}

const ACRONYMS: Record<string, string> = {
  cfpb: "CFPB", fcra: "FCRA", fdcpa: "FDCPA", fincen: "FinCEN",
  glba: "GLBA", hpa: "HPA", scra: "SCRA", tcpa: "TCPA",
  udaap: "UDAAP", ofac: "OFAC", fha: "FHA", usda: "USDA",
  va: "VA", gse: "GSE", mbs: "MBS", mers: "MERS", cwcot: "CWCOT",
  arm: "ARM", heloc: "HELOC", mi: "MI", pmi: "PMI", dc: "DC",
  reo: "REO", hud: "HUD", respa: "RESPA", tila: "TILA",
  qc: "QC", ach: "ACH", api: "API", llc: "LLC", lp: "LP",
};

function slugToLabel(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b\w+\b/g, (word) => ACRONYMS[word.toLowerCase()] ?? word);
}

interface TopicFolder {
  relativePath: string;
  absPath: string;
  nameParts: string[];
  skillMd: string | null;
  detailFiles: string[];
  tags: string[];
}

function discoverTopicFolders(dir: string, pathParts: string[] = []): TopicFolder[] {
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
      tags: ["vds", ...pathParts],
    });
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      folders.push(
        ...discoverTopicFolders(path.join(dir, entry.name), [...pathParts, entry.name])
      );
    }
  }

  return folders;
}

async function main() {
  const topics = discoverTopicFolders(VDS_ROOT);
  console.log(`Discovered ${topics.length} topic folders.\n`);

  let imported = 0;
  let skipped = 0;

  await client.begin(async (tx) => {
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];

      // Build merged content
      const parts: string[] = [];
      if (topic.skillMd) {
        parts.push(stripFrontmatter(readMd(topic.skillMd)));
      }
      for (const detailFile of topic.detailFiles.sort()) {
        const fileName = path.basename(detailFile, ".md");
        const content = stripFrontmatter(readMd(detailFile));
        parts.push(`\n---\n\n## ${slugToLabel(fileName)}\n\n${content}`);
      }

      const mergedContent = parts.join("\n\n");
      if (!mergedContent.trim()) {
        skipped++;
        continue;
      }

      // Deterministic UUID from path
      const hash = crypto.createHash("md5").update(`vds-entities/${topic.relativePath}`).digest("hex");
      const uuid = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");

      // Name: "VDS > Core Loan > Loan"
      const name = topic.nameParts.length > 0
        ? "VDS > " + topic.nameParts.map(slugToLabel).join(" > ")
        : "VDS > Overview";

      const tokenCount = Math.round(mergedContent.length / 4);

      const result = await tx`
        INSERT INTO context (
          id, workspace_id, name, category, subcategory, entity_id, field_id,
          content, content_format, token_count, tags, is_active, sort_order,
          import_source, metadata, created_at, updated_at
        ) VALUES (
          ${uuid}, ${WORKSPACE_ID}, ${name}, 'schema', 'data_dictionary', NULL, NULL,
          ${mergedContent}, 'markdown', ${tokenCount}, ${JSON.stringify(topic.tags)}, 1, ${i},
          ${"vds-entities/" + topic.relativePath}, NULL,
          NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;

      if (result.count > 0) {
        imported++;
        console.log(`  [+] ${name} (${tokenCount} tokens)`);
      } else {
        skipped++;
        console.log(`  [=] ${name} (already exists)`);
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
