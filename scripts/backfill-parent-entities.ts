/**
 * Backfill parentEntityId for existing component entities.
 * Finds entities whose description starts with "Component of" and sets
 * their parentEntityId to the matching parent entity.
 *
 * Usage: npx tsx scripts/backfill-parent-entities.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

// Ensure the column exists
try {
  db.exec("ALTER TABLE entity ADD COLUMN parent_entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL");
  console.log("Added parent_entity_id column");
} catch {
  // Column already exists
  console.log("parent_entity_id column already exists");
}

// Ensure index exists
db.exec("CREATE INDEX IF NOT EXISTS entity_parent_idx ON entity(parent_entity_id)");

// Find component entities
const components = db
  .prepare("SELECT id, name, description, workspace_id FROM entity WHERE description LIKE 'Component of %'")
  .all() as { id: string; name: string; description: string; workspace_id: string }[];

console.log(`Found ${components.length} component entities to backfill`);

const updateStmt = db.prepare("UPDATE entity SET parent_entity_id = ? WHERE id = ?");
const findParent = db.prepare(
  "SELECT id FROM entity WHERE name = ? AND workspace_id = ? AND side = 'target' AND (description IS NULL OR description NOT LIKE 'Component of %')"
);

let updated = 0;
let skipped = 0;

for (const comp of components) {
  // Parse parent name from description: "Component of {parentName}: ..."
  const match = comp.description.match(/^Component of ([^:]+):/);
  if (!match) {
    console.warn(`  Could not parse parent name from description: "${comp.description}"`);
    skipped++;
    continue;
  }

  const parentName = match[1].trim();
  const parent = findParent.get(parentName, comp.workspace_id) as { id: string } | undefined;

  if (!parent) {
    console.warn(`  Parent entity "${parentName}" not found for component "${comp.name}"`);
    skipped++;
    continue;
  }

  updateStmt.run(parent.id, comp.id);
  console.log(`  Set parentEntityId for "${comp.name}" → "${parentName}" (${parent.id})`);
  updated++;
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
db.close();
