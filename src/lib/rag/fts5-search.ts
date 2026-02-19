import { getSqliteDb } from "@/lib/db";

interface FtsResult {
  contextId: string;
  name: string;
  rank: number;
}

/**
 * Sanitize a user query for FTS5 MATCH syntax.
 * Splits into words, removes FTS5 special characters, joins with OR for broad recall.
 */
function sanitizeFtsQuery(query: string): string {
  const words = query
    .replace(/[*"():^{}[\]\\]/g, "") // strip FTS5 special chars
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1); // skip single chars

  if (words.length === 0) return "";

  // Quote each word to prevent FTS5 syntax interpretation, join with OR
  return words.map((w) => `"${w}"`).join(" OR ");
}

/**
 * Full-text search over the context_fts virtual table.
 * Returns matching context IDs ranked by BM25 relevance.
 */
export function searchContextsFts(
  workspaceId: string,
  query: string,
  limit: number = 10
): FtsResult[] {
  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];

  const sqlite = getSqliteDb();

  // Check if FTS5 table exists
  const tableExists = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='context_fts'"
    )
    .get();

  if (!tableExists) {
    console.warn(
      "context_fts table not found. Run: npx tsx scripts/migrate-fts5.ts"
    );
    return [];
  }

  const stmt = sqlite.prepare(`
    SELECT context_id, name, rank
    FROM context_fts
    WHERE context_fts MATCH ?
      AND workspace_id = ?
    ORDER BY rank
    LIMIT ?
  `);

  const rows = stmt.all(ftsQuery, workspaceId, limit) as Array<{
    context_id: string;
    name: string;
    rank: number;
  }>;

  return rows.map((r) => ({
    contextId: r.context_id,
    name: r.name,
    rank: r.rank,
  }));
}
