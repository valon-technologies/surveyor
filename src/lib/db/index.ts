import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Use a singleton for the postgres client to avoid connection leaks in serverless
const globalForDb = globalThis as unknown as {
  pg: ReturnType<typeof postgres> | undefined;
};

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is not set");
  return url;
}

const pg =
  globalForDb.pg ??
  postgres(getConnectionString(), {
    prepare: false, // required for Supabase connection pooling (PgBouncer)
    max: 10,
    idle_timeout: 30,
    connect_timeout: 15,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pg = pg;
}

export const db: PostgresJsDatabase<typeof schema> = drizzle(pg, { schema });

export type DB = PostgresJsDatabase<typeof schema>;

/** Run a callback inside a Postgres transaction. */
export async function withTransaction<T>(
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
