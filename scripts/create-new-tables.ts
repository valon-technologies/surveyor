/**
 * Creates new tables (context, comment_thread, comment) and adds new columns
 * to field_mapping. Idempotent -- safe to run multiple times.
 *
 * Usage: npx tsx scripts/create-new-tables.ts
 */

import postgres from "postgres";
import "dotenv/config";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });

async function tableExists(name: string): Promise<boolean> {
  const result = await client`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) as exists
  `;
  return result[0].exists;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await client`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) as exists
  `;
  return result[0].exists;
}

async function main() {
  // --- context table ---
  if (!(await tableExists("context"))) {
    console.log("Creating context table...");
    await client.unsafe(`
      CREATE TABLE context (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT,
        entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
        field_id TEXT REFERENCES field(id) ON DELETE SET NULL,
        content TEXT NOT NULL DEFAULT '',
        content_format TEXT NOT NULL DEFAULT 'markdown',
        token_count INTEGER,
        tags TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        import_source TEXT,
        metadata TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX context_workspace_idx ON context(workspace_id);
      CREATE INDEX context_category_idx ON context(workspace_id, category);
      CREATE INDEX context_entity_idx ON context(entity_id);
      CREATE INDEX context_field_idx ON context(field_id);
    `);
    console.log("  context table created.");
  } else {
    console.log("context table already exists.");
  }

  // --- comment_thread table ---
  if (!(await tableExists("comment_thread"))) {
    console.log("Creating comment_thread table...");
    await client.unsafe(`
      CREATE TABLE comment_thread (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        entity_id TEXT REFERENCES entity(id) ON DELETE CASCADE,
        field_mapping_id TEXT REFERENCES field_mapping(id) ON DELETE CASCADE,
        subject TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        resolved_by TEXT,
        resolved_at TEXT,
        comment_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX thread_workspace_idx ON comment_thread(workspace_id);
      CREATE INDEX thread_entity_idx ON comment_thread(entity_id);
      CREATE INDEX thread_mapping_idx ON comment_thread(field_mapping_id);
      CREATE INDEX thread_status_idx ON comment_thread(workspace_id, status);
    `);
    console.log("  comment_thread table created.");
  } else {
    console.log("comment_thread table already exists.");
  }

  // --- comment table ---
  if (!(await tableExists("comment"))) {
    console.log("Creating comment table...");
    await client.unsafe(`
      CREATE TABLE comment (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES comment_thread(id) ON DELETE CASCADE,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL,
        body_format TEXT NOT NULL DEFAULT 'markdown',
        metadata TEXT,
        edited_at TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX comment_thread_idx ON comment(thread_id);
      CREATE INDEX comment_thread_created_idx ON comment(thread_id, created_at);
    `);
    console.log("  comment table created.");
  } else {
    console.log("comment table already exists.");
  }

  // --- Add new columns to field_mapping ---
  if (!(await columnExists("field_mapping", "edited_by"))) {
    console.log("Adding edited_by column to field_mapping...");
    await client.unsafe("ALTER TABLE field_mapping ADD COLUMN edited_by TEXT");
    console.log("  edited_by column added.");
  } else {
    console.log("field_mapping.edited_by already exists.");
  }

  if (!(await columnExists("field_mapping", "change_summary"))) {
    console.log("Adding change_summary column to field_mapping...");
    await client.unsafe("ALTER TABLE field_mapping ADD COLUMN change_summary TEXT");
    console.log("  change_summary column added.");
  } else {
    console.log("field_mapping.change_summary already exists.");
  }

  // --- Add context_id to mapping_context (if still using skill_id) ---
  if (!(await columnExists("mapping_context", "context_id"))) {
    console.log("Adding context_id column to mapping_context...");
    await client.unsafe("ALTER TABLE mapping_context ADD COLUMN context_id TEXT REFERENCES context(id) ON DELETE SET NULL");
    await client.unsafe("CREATE INDEX IF NOT EXISTS mapping_context_context_idx ON mapping_context(context_id)");
    // Copy existing skill_id values
    if (await columnExists("mapping_context", "skill_id")) {
      await client`UPDATE mapping_context SET context_id = skill_id WHERE skill_id IS NOT NULL`;
      console.log("  Copied skill_id -> context_id values.");
    }
    console.log("  context_id column added.");
  } else {
    console.log("mapping_context.context_id already exists.");
  }

  // --- Update context_type values ---
  const updated = await client`
    UPDATE mapping_context SET context_type = 'context_reference' WHERE context_type = 'skill_reference'
  `;
  if (updated.count > 0) {
    console.log(`Updated ${updated.count} mapping_context rows: skill_reference -> context_reference`);
  }

  console.log("\nDone! All tables and columns are ready.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
