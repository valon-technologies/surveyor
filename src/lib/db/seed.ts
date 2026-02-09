import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { workspace } from "./schema";
import { join } from "path";

async function seed() {
  const dbPath = process.env.DATABASE_PATH || join(process.cwd(), "surveyor.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);

  console.log(`Seeding database at ${dbPath}...`);

  // Create default workspace
  const [ws] = db
    .insert(workspace)
    .values({
      name: "Default Workspace",
      description: "Field-level schema mapping workspace",
      settings: { defaultProvider: "claude" },
    })
    .returning().all();

  console.log(`Created workspace: ${ws.id}`);
  console.log("\nSeed complete!");
  console.log(`\nWorkspace ID: ${ws.id}`);
  console.log(`Update DEFAULT_WORKSPACE_ID in src/lib/constants.ts if needed.`);

  sqlite.close();
}

seed().catch(console.error);
