/**
 * Import mortgage-domain skills as foundational context documents.
 *
 * Strategy: For each topic folder, merge SKILL.md + detail files into one context doc.
 * Tags derived from the folder path (e.g., ["federal", "cfpb", "escrow"]).
 *
 * Usage: npx tsx scripts/import-mortgage-domain.ts
 */

import postgres from "postgres";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import "dotenv/config";

const SKILLS_ROOT = "/Users/grantlee/Dev/mapping-skills/.claude/skills/mortgage-domain";
const WORKSPACE_ID = "847602b2-188d-4fca-b1b1-d6098bb22aba";

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
  name: string;
  path: string;
  skillMd: string | null;
  detailFiles: string[];
  tags: string[];
}

function discoverTopicFolders(dir: string, pathParts: string[] = []): TopicFolder[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders: TopicFolder[] = [];

  // Check if this directory itself is a topic (has SKILL.md or .md files)
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
  const hasSkillMd = mdFiles.includes("SKILL.md");
  const detailFiles = mdFiles.filter((f) => f !== "SKILL.md");

  if (hasSkillMd || detailFiles.length > 0) {
    folders.push({
      name: pathParts.length > 0 ? pathParts[pathParts.length - 1] : "mortgage-domain",
      path: dir,
      skillMd: hasSkillMd ? path.join(dir, "SKILL.md") : null,
      detailFiles: detailFiles.map((f) => path.join(dir, f)),
      tags: [...pathParts],
    });
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const subFolders = discoverTopicFolders(
        path.join(dir, entry.name),
        [...pathParts, entry.name]
      );
      folders.push(...subFolders);
    }
  }

  return folders;
}

async function main() {
  // Discover all topic folders
  const topics = discoverTopicFolders(SKILLS_ROOT);
  console.log(`Discovered ${topics.length} topic folders.\n`);

  // Preview what we'll import
  for (const t of topics) {
    const fileCount = (t.skillMd ? 1 : 0) + t.detailFiles.length;
    console.log(`  ${t.tags.join("/")} — ${fileCount} file(s)`);
  }

  console.log("\n--- Starting import ---\n");

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

      // Generate a deterministic ID from the path
      const relativePath = path.relative(SKILLS_ROOT, topic.path);
      const id = crypto.createHash("md5").update(`mortgage-domain/${relativePath}`).digest("hex");
      // Format as UUID
      const uuid = [id.slice(0, 8), id.slice(8, 12), id.slice(12, 16), id.slice(16, 20), id.slice(20, 32)].join("-");

      // Name from path
      const name = topic.tags.length > 0
        ? "Mortgage Servicing > " + topic.tags.map(slugToLabel).join(" > ")
        : "Mortgage Servicing > Overview";

      // Rough token estimate (chars / 4)
      const tokenCount = Math.round(mergedContent.length / 4);

      const tagsJson = JSON.stringify(topic.tags.length > 0 ? topic.tags : ["mortgage-domain"]);
      const importSource = `mortgage-domain/${relativePath}`;

      const result = await tx`
        INSERT INTO context (
          id, workspace_id, name, category, subcategory, entity_id, field_id,
          content, content_format, token_count, tags, is_active, sort_order,
          import_source, metadata, created_at, updated_at
        ) VALUES (
          ${uuid}, ${WORKSPACE_ID}, ${name}, 'foundational', 'domain_knowledge', NULL, NULL,
          ${mergedContent}, 'markdown', ${tokenCount}, ${tagsJson}, true, ${i},
          ${importSource}, NULL,
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
