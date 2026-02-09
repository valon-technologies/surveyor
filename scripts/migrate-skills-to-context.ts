/**
 * Migration script: skill → context table
 *
 * Maps old skill categories to new context categories + subcategories:
 * - domain_knowledge → foundational / domain_knowledge
 * - entity_fields    → schema / field_spec
 * - entity_enums     → schema / enum_map
 * - entity_mapping   → schema / data_dictionary
 * - rules            → foundational / business_rules
 * - examples         → adhoc / working_doc
 * - validation       → foundational / business_rules
 *
 * Also updates mapping_context rows: skillId → contextId, skill_reference → context_reference
 *
 * Usage: npx tsx scripts/migrate-skills-to-context.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);

const CATEGORY_MAP: Record<string, { category: string; subcategory: string }> = {
  domain_knowledge: { category: "foundational", subcategory: "domain_knowledge" },
  entity_fields: { category: "schema", subcategory: "field_spec" },
  entity_enums: { category: "schema", subcategory: "enum_map" },
  entity_mapping: { category: "schema", subcategory: "data_dictionary" },
  rules: { category: "foundational", subcategory: "business_rules" },
  examples: { category: "adhoc", subcategory: "working_doc" },
  validation: { category: "foundational", subcategory: "business_rules" },
};

// Check if skill table exists
const skillTableExists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='skill'"
).get();

if (!skillTableExists) {
  console.log("No skill table found — nothing to migrate.");
  process.exit(0);
}

// Check if context table exists
const contextTableExists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='context'"
).get();

if (!contextTableExists) {
  console.error("Context table does not exist. Run `npm run db:push` first.");
  process.exit(1);
}

interface SkillRow {
  id: string;
  workspace_id: string;
  name: string;
  category: string;
  entity_id: string | null;
  content: string;
  content_format: string;
  token_count: number | null;
  tags: string | null;
  is_active: number;
  sort_order: number;
  import_source: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

const skills = db.prepare("SELECT * FROM skill").all() as SkillRow[];
console.log(`Found ${skills.length} skill rows to migrate.`);

const insertContext = db.prepare(`
  INSERT INTO context (
    id, workspace_id, name, category, subcategory, entity_id, field_id,
    content, content_format, token_count, tags, is_active, sort_order,
    import_source, metadata, created_at, updated_at
  ) VALUES (
    @id, @workspace_id, @name, @category, @subcategory, @entity_id, NULL,
    @content, @content_format, @token_count, @tags, @is_active, @sort_order,
    @import_source, @metadata, @created_at, @updated_at
  )
`);

const migrate = db.transaction(() => {
  let migrated = 0;
  let skipped = 0;

  for (const skill of skills) {
    const mapping = CATEGORY_MAP[skill.category];
    if (!mapping) {
      console.warn(`  Skipping skill "${skill.name}" — unknown category "${skill.category}"`);
      skipped++;
      continue;
    }

    // Check if already migrated (same id)
    const existing = db.prepare("SELECT id FROM context WHERE id = ?").get(skill.id);
    if (existing) {
      console.log(`  Skipping "${skill.name}" — already exists in context table`);
      skipped++;
      continue;
    }

    insertContext.run({
      id: skill.id,
      workspace_id: skill.workspace_id,
      name: skill.name,
      category: mapping.category,
      subcategory: mapping.subcategory,
      entity_id: skill.entity_id,
      content: skill.content,
      content_format: skill.content_format,
      token_count: skill.token_count,
      tags: skill.tags,
      is_active: skill.is_active,
      sort_order: skill.sort_order,
      import_source: skill.import_source,
      metadata: skill.metadata,
      created_at: skill.created_at,
      updated_at: skill.updated_at,
    });
    migrated++;
  }

  // Update mapping_context: rename skill_id → context_id if the column exists
  // Since db:push creates the new schema, mapping_context should already have context_id
  // We need to copy skill_id values into context_id
  const mcHasSkillId = db.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('mapping_context') WHERE name='skill_id'"
  ).get() as { cnt: number };

  if (mcHasSkillId.cnt > 0) {
    db.prepare("UPDATE mapping_context SET context_id = skill_id WHERE skill_id IS NOT NULL").run();
    console.log("  Updated mapping_context: copied skill_id → context_id");
  }

  // Update context_type values
  db.prepare(
    "UPDATE mapping_context SET context_type = 'context_reference' WHERE context_type = 'skill_reference'"
  ).run();
  console.log("  Updated mapping_context: skill_reference → context_reference");

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped.`);
});

migrate();
db.close();
