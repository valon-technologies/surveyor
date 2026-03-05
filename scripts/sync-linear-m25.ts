/**
 * Sync Linear M2.5 dashboard data into Surveyor:
 * 1. Parse ACDC Field + Mapping Logic from Linear issue descriptions
 * 2. Store as notes on field_mapping records (visible on discuss page)
 * 3. Exclude Descoped/Canceled fields
 *
 * Usage: npx tsx scripts/sync-linear-m25.ts [--dry-run]
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx < 1 || line.trimStart().startsWith("#")) continue;
  process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/\r$/, "");
}

const DRY_RUN = process.argv.includes("--dry-run");

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string };
}

interface ParsedIssue {
  title: string;
  identifier: string;
  state: string;
  acdcField: string;
  mappingLogic: string;
  implStatus: string;
  definition: string;
  enumValues: string;
  fieldType: string;
}

function parseDescription(desc: string | null): Omit<ParsedIssue, "title" | "identifier" | "state"> {
  const result = { acdcField: "", mappingLogic: "", implStatus: "", definition: "", enumValues: "", fieldType: "" };
  if (!desc) return result;

  const extract = (label: string): string => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*\`\`\`\\s*([\\s\\S]*?)\\s*\`\`\``, "m");
    const m = desc.match(re);
    const val = m?.[1]?.trim() || "";
    return val === "(empty)" ? "" : val;
  };

  result.acdcField = extract("ACDC Field");
  result.mappingLogic = extract("Mapping Logic");
  result.implStatus = extract("Implementation Status");
  result.definition = extract("Definition");
  result.enumValues = extract("Enum Values");
  result.fieldType = extract("Type");
  return result;
}

async function fetchAllM25Issues(): Promise<LinearIssue[]> {
  const apiKey = process.env.GESTALT_API_KEY;
  if (!apiKey) throw new Error("GESTALT_API_KEY not set");

  const url = "https://api.gestalt.peachstreet.dev/api/v1/linear/gql";
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  const allNodes: LinearIssue[] = [];
  let hasNext = true;
  let cursor: string | null = null;

  while (hasNext) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `{ issues(filter: { labels: { name: { eq: "M2.5" } } }, first: 250${afterClause}) { pageInfo { hasNextPage endCursor } nodes { id identifier title description state { name } } } }`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    const issues = data.data.issues;
    allNodes.push(...issues.nodes);
    hasNext = issues.pageInfo.hasNextPage;
    cursor = issues.pageInfo.endCursor;
  }

  return allNodes;
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { field, fieldMapping, entity } = await import("../src/lib/db/schema");
  const { eq, and, sql } = await import("drizzle-orm");

  // Get workspace
  const [ws] = await db.select().from(entity).limit(1);
  const workspaceId = ws.workspaceId;

  console.log("Fetching Linear M2.5 issues...");
  const issues = await fetchAllM25Issues();
  console.log(`Fetched ${issues.length} issues`);

  // Parse all issues
  const parsed: ParsedIssue[] = issues.map((i) => ({
    title: i.title.toLowerCase().trim(),
    identifier: i.identifier,
    state: i.state.name,
    ...parseDescription(i.description),
  }));

  // Build lookup by field name
  const issueByFieldName = new Map<string, ParsedIssue>();
  for (const p of parsed) {
    issueByFieldName.set(p.title, p);
  }

  // Load all M2.5 fields with their entities
  const m25Fields = await db
    .select({
      fieldId: field.id,
      fieldName: field.name,
      entityId: field.entityId,
      entityName: sql<string>`(SELECT name FROM entity WHERE id = ${field.entityId})`,
    })
    .from(field)
    .where(eq(field.milestone, "M2.5"));

  let synced = 0;
  let excluded = 0;
  let noMatch = 0;
  let noMapping = 0;

  for (const f of m25Fields) {
    const issue = issueByFieldName.get(f.fieldName);
    if (!issue) {
      noMatch++;
      continue;
    }

    // Handle Descoped/Canceled — exclude
    if (issue.state === "Descoped" || issue.state === "Canceled") {
      if (DRY_RUN) {
        console.log(`  [exclude] ${f.entityName}.${f.fieldName} (${issue.state})`);
        excluded++;
        continue;
      }

      // Check for existing mapping
      const [existing] = await db
        .select({ id: fieldMapping.id })
        .from(fieldMapping)
        .where(and(eq(fieldMapping.targetFieldId, f.fieldId), eq(fieldMapping.isLatest, true)));

      if (existing) {
        await db.update(fieldMapping)
          .set({
            status: "excluded",
            excludeReason: `${issue.state} in Linear (${issue.identifier})`,
          })
          .where(eq(fieldMapping.id, existing.id));
      } else {
        await db.insert(fieldMapping).values({
          workspaceId,
          targetFieldId: f.fieldId,
          status: "excluded",
          excludeReason: `${issue.state} in Linear (${issue.identifier})`,
          createdBy: "import",
          isLatest: true,
          version: 1,
        });
      }
      excluded++;
      continue;
    }

    // For all other states — sync Linear data as notes
    const hasInfo = issue.acdcField || issue.mappingLogic || issue.implStatus;
    if (!hasInfo) continue;

    // Build reference note
    const parts: string[] = [`[Linear ${issue.identifier}] Status: ${issue.state}`];
    if (issue.acdcField) parts.push(`ACDC Source: ${issue.acdcField}`);
    if (issue.mappingLogic) parts.push(`Mapping Logic: ${issue.mappingLogic}`);
    if (issue.implStatus) parts.push(`Implementation: ${issue.implStatus}`);
    const note = parts.join("\n");

    // Find existing mapping
    const [existing] = await db
      .select({ id: fieldMapping.id, notes: fieldMapping.notes })
      .from(fieldMapping)
      .where(and(eq(fieldMapping.targetFieldId, f.fieldId), eq(fieldMapping.isLatest, true)));

    if (!existing) {
      noMapping++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [sync] ${f.entityName}.${f.fieldName}: ${note.slice(0, 80)}`);
      synced++;
      continue;
    }

    // Append Linear info to notes (don't overwrite existing)
    const existingNotes = existing.notes || "";
    const alreadySynced = existingNotes.includes("[Linear ");
    if (alreadySynced) continue; // Already synced

    const newNotes = existingNotes
      ? `${existingNotes}\n\n--- Linear Reference ---\n${note}`
      : `--- Linear Reference ---\n${note}`;

    await db.update(fieldMapping)
      .set({ notes: newNotes })
      .where(eq(fieldMapping.id, existing.id));
    synced++;
  }

  console.log(`\nResults:`);
  console.log(`  Synced Linear data: ${synced}`);
  console.log(`  Excluded (Descoped/Canceled): ${excluded}`);
  console.log(`  No Linear match: ${noMatch}`);
  console.log(`  No mapping record to update: ${noMapping}`);
  if (DRY_RUN) console.log(`  [dry-run] No changes written`);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
