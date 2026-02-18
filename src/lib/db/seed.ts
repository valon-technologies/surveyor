import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { workspace } from "./schema";

function seed() {
  const sqlite = new Database(process.env.DATABASE_PATH || "./surveyor.db");
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);

  console.log("Seeding database...");

  // Create default workspace
  const [ws] = db
    .insert(workspace)
    .values({
      name: "Default Workspace",
      description: "Field-level schema mapping workspace",
      settings: { defaultProvider: "claude" },
    })
    .returning()
    .all();

  console.log(`Created workspace: ${ws.id}`);
  console.log("\nSeed complete!");
  console.log(`\nWorkspace ID: ${ws.id}`);
  console.log(`Update DEFAULT_WORKSPACE_ID in src/lib/constants.ts if needed.`);
}

seed();
