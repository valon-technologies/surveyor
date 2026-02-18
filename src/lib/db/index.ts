import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { join } from "path";

let _db: BetterSQLite3Database<typeof schema> | null = null;

function getDbPath(): string {
  return process.env.DATABASE_PATH || join(process.cwd(), "surveyor.db");
}

export function getDb() {
  if (!_db) {
    const sqlite = new Database(getDbPath());
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

// Proxy that lazily initializes on first property access
export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export type DB = BetterSQLite3Database<typeof schema>;
