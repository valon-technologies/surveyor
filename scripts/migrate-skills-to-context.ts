/**
 * Migration script: skill -> context table
 *
 * Maps old skill categories to new context categories + subcategories:
 * - domain_knowledge -> foundational / domain_knowledge
 * - entity_fields    -> schema / field_spec
 * - entity_enums     -> schema / enum_map
 * - entity_mapping   -> schema / data_dictionary
 * - rules            -> foundational / business_rules
 * - examples         -> adhoc / working_doc
 * - validation       -> foundational / business_rules
 *
 * Also updates mapping_context rows: skillId -> contextId, skill_reference -> context_reference
 *
 * Usage: npx tsx scripts/migrate-skills-to-context.ts
 */

import postgres from "postgres";
import "dotenv/config";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });

const CATEGORY_MAP: Record<string, { category: string; subcategory: string }> = {
  domain_knowledge: { category: "foundational", subcategory: "domain_knowledge" },
  entity_fields: { category: "schema", subcategory: "field_spec" },
  entity_enums: { category: "schema", subcategory: "enum_map" },
  entity_mapping: { category: "schema", subcategory: "data_dictionary" },
  rules: { category: "foundational", subcategory: "business_rules" },
  examples: { category: "adhoc", subcategory: "working_doc" },
  validation: { category: "foundational", subcategory: "business_rules" },
};

async function main() {
  // Check if skill table exists
  const skillTableCheck = await client`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'skill'
    ) as exists
  `;

  if (!skillTableCheck[0].exists) {
    console.log("No skill table found -- nothing to migrate.");
    await client.end();
    process.exit(0);
  }

  // Check if context table exists
  const contextTableCheck = await client`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'context'
    ) as exists
  `;

  if (!contextTableCheck[0].exists) {
    console.error("Context table does not exist. Run `npm run db:push` first.");
    await client.end();
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

  const skills = await client`SELECT * FROM skill` as SkillRow[];
  console.log(`Found ${skills.length} skill rows to migrate.`);

  await client.begin(async (tx) => {
    let migrated = 0;
    let skipped = 0;

    for (const skill of skills) {
      const mapping = CATEGORY_MAP[skill.category];
      if (!mapping) {
        console.warn(`  Skipping skill "${skill.name}" -- unknown category "${skill.category}"`);
        skipped++;
        continue;
      }

      // Check if already migrated (same id)
      const existing = await tx`SELECT id FROM context WHERE id = ${skill.id}`;
      if (existing.length > 0) {
        console.log(`  Skipping "${skill.name}" -- already exists in context table`);
        skipped++;
        continue;
      }

      await tx`
        INSERT INTO context (
          id, workspace_id, name, category, subcategory, entity_id, field_id,
          content, content_format, token_count, tags, is_active, sort_order,
          import_source, metadata, created_at, updated_at
        ) VALUES (
          ${skill.id}, ${skill.workspace_id}, ${skill.name}, ${mapping.category}, ${mapping.subcategory}, ${skill.entity_id}, NULL,
          ${skill.content}, ${skill.content_format}, ${skill.token_count}, ${skill.tags}, ${skill.is_active}, ${skill.sort_order},
          ${skill.import_source}, ${skill.metadata}, ${skill.created_at}, ${skill.updated_at}
        )
      `;
      migrated++;
    }

    // Update mapping_context: rename skill_id -> context_id if the column exists
    const mcHasSkillId = await tx`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mapping_context' AND column_name = 'skill_id'
      ) as exists
    `;

    if (mcHasSkillId[0].exists) {
      await tx`UPDATE mapping_context SET context_id = skill_id WHERE skill_id IS NOT NULL`;
      console.log("  Updated mapping_context: copied skill_id -> context_id");
    }

    // Update context_type values
    await tx`
      UPDATE mapping_context SET context_type = 'context_reference' WHERE context_type = 'skill_reference'
    `;
    console.log("  Updated mapping_context: skill_reference -> context_reference");

    console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped.`);
  });

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
