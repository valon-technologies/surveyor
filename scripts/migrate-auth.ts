/**
 * Migration script: Creates auth tables, system user, and links existing workspace.
 *
 * Run: npx tsx scripts/migrate-auth.ts
 */
import Database from "better-sqlite3";
import { join } from "path";
import bcrypt from "bcryptjs";

const dbPath = process.env.DATABASE_PATH || join(process.cwd(), "surveyor.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

console.log(`Migrating database at ${dbPath}...`);

// Create auth tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL UNIQUE,
    email_verified TEXT,
    image TEXT,
    password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT
  );
  CREATE INDEX IF NOT EXISTS account_user_idx ON account(user_id);

  CREATE TABLE IF NOT EXISTS verification_token (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL,
    expires TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS verification_token_idx ON verification_token(identifier, token);

  CREATE TABLE IF NOT EXISTS user_api_key (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    key_prefix TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS user_api_key_user_idx ON user_api_key(user_id);
  CREATE INDEX IF NOT EXISTS user_api_key_user_provider_idx ON user_api_key(user_id, provider);

  CREATE TABLE IF NOT EXISTS workspace_invite (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    status TEXT NOT NULL DEFAULT 'pending',
    invited_by TEXT NOT NULL REFERENCES user(id),
    accepted_by TEXT REFERENCES user(id),
    accepted_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS workspace_invite_workspace_idx ON workspace_invite(workspace_id);
  CREATE INDEX IF NOT EXISTS workspace_invite_email_idx ON workspace_invite(email);

  CREATE TABLE IF NOT EXISTS user_workspace (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS user_workspace_user_idx ON user_workspace(user_id);
  CREATE INDEX IF NOT EXISTS user_workspace_workspace_idx ON user_workspace(workspace_id);
`);

console.log("Auth tables created.");

// Check if system user already exists
const existingUser = sqlite.prepare("SELECT id FROM user WHERE email = ?").get("admin@surveyor.local") as { id: string } | undefined;

if (existingUser) {
  console.log(`System user already exists: ${existingUser.id}`);
} else {
  // Create system user
  const userId = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync("surveyor-admin", 12);

  sqlite.prepare(
    "INSERT INTO user (id, name, email, password_hash) VALUES (?, ?, ?, ?)"
  ).run(userId, "Admin", "admin@surveyor.local", passwordHash);

  console.log(`Created system user: ${userId} (admin@surveyor.local / surveyor-admin)`);

  // Link all existing workspaces to this user as owner
  const workspaces = sqlite.prepare("SELECT id, name FROM workspace").all() as { id: string; name: string }[];

  for (const ws of workspaces) {
    const existing = sqlite.prepare(
      "SELECT id FROM user_workspace WHERE user_id = ? AND workspace_id = ?"
    ).get(userId, ws.id);

    if (!existing) {
      sqlite.prepare(
        "INSERT INTO user_workspace (id, user_id, workspace_id, role) VALUES (?, ?, ?, ?)"
      ).run(crypto.randomUUID(), userId, ws.id, "owner");
      console.log(`Linked workspace "${ws.name}" (${ws.id}) to system user as owner`);
    }
  }
}

sqlite.close();
console.log("\nAuth migration complete!");
console.log("You can sign in with: admin@surveyor.local / surveyor-admin");
