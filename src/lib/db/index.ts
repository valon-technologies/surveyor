import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { join } from "path";

let _sqlite: Database.Database | null = null;
let _db: BetterSQLite3Database<typeof schema> | null = null;

function getDbPath(): string {
  return process.env.DATABASE_PATH || join(process.cwd(), "surveyor.db");
}

/** Get the raw better-sqlite3 instance (for FTS5, raw SQL, etc.) */
export function getSqliteDb(): Database.Database {
  if (!_sqlite) {
    _sqlite = new Database(getDbPath());
    _sqlite.pragma("journal_mode = WAL");
    _sqlite.pragma("foreign_keys = ON");
    _sqlite.pragma("busy_timeout = 5000");
    _db = drizzle(_sqlite, { schema });
  }
  return _sqlite;
}

export function getDb() {
  if (!_db) {
    // Ensure _sqlite is initialized first, then wrap with Drizzle
    getSqliteDb();
  }
  return _db!;
}

// Proxy that lazily initializes on first property access
export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

/** Run a callback inside a SQLite IMMEDIATE transaction. */
export function withTransaction<T>(fn: () => T): T {
  return getSqliteDb().transaction(fn)();
}

export type DB = BetterSQLite3Database<typeof schema>;
