import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { sql, eq, and } from "drizzle-orm";

interface FtsResult {
  contextId: string;
  name: string;
  rank: number;
}

/**
 * Full-text search over the context table using Postgres plainto_tsquery.
 * Returns matching context IDs ranked by relevance.
 */
export async function searchContextsFts(
  workspaceId: string,
  query: string,
  limit: number = 10
): Promise<FtsResult[]> {
  const words = query
    .replace(/[*"():^{}[\]\\<>!@#$%&]/g, "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);

  if (words.length === 0) return [];

  const results = await db
    .select({
      contextId: context.id,
      name: context.name,
    })
    .from(context)
    .where(
      and(
        eq(context.workspaceId, workspaceId),
        eq(context.isActive, true),
        sql`to_tsvector('english', coalesce(${context.name}, '') || ' ' || coalesce(${context.content}, '')) @@ plainto_tsquery('english', ${query})`
      )
    )
    .orderBy(
      sql`ts_rank(to_tsvector('english', coalesce(${context.name}, '') || ' ' || coalesce(${context.content}, '')), plainto_tsquery('english', ${query})) DESC`
    )
    .limit(limit);

  return results.map((r, i) => ({
    contextId: r.contextId,
    name: r.name,
    rank: -(i + 1),
  }));
}
