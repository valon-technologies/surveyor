import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { workspace } from "./schema";

async function seed() {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client);

  console.log("Seeding database...");

  // Create default workspace
  const [ws] = await db
    .insert(workspace)
    .values({
      name: "Default Workspace",
      description: "Field-level schema mapping workspace",
      settings: { defaultProvider: "claude" },
    })
    .returning();

  console.log(`Created workspace: ${ws.id}`);
  console.log("\nSeed complete!");
  console.log(`\nWorkspace ID: ${ws.id}`);
  console.log(`Update DEFAULT_WORKSPACE_ID in src/lib/constants.ts if needed.`);

  await client.end();
}

seed().catch(console.error);
