import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const GET = withAuth(
  async () => {
    // Get per-table sizes via Postgres system catalog
    const tableSizes = await db.execute<{ name: string; size_bytes: number }>(sql`
      SELECT relname as name,
             pg_total_relation_size(c.oid)::bigint as size_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY size_bytes DESC
    `);

    // Get total DB size
    const [dbSize] = await db.execute<{ total_size_bytes: number }>(sql`
      SELECT pg_database_size(current_database())::bigint as total_size_bytes
    `);
    const totalSizeBytes = Number(dbSize?.total_size_bytes ?? 0);

    // Get row counts for key tables
    const keyTables = [
      "chat_message",
      "chat_session",
      "generation",
      "learning",
      "batch_run",
      "context",
      "field_mapping",
      "entity_pipeline",
      "question",
      "evaluation",
      "activity",
      "validation",
    ];

    const rowCounts: Record<string, number> = {};
    for (const table of keyTables) {
      try {
        const [result] = await db.execute<{ count: number }>(
          sql.raw(`SELECT COUNT(*)::int as count FROM "${table}"`)
        );
        rowCounts[table] = Number(result?.count ?? 0);
      } catch {
        rowCounts[table] = 0;
      }
    }

    // Merge sizes with row counts
    const sizeMap = new Map(
      (tableSizes as { name: string; size_bytes: number }[]).map((t) => [t.name, Number(t.size_bytes)])
    );

    const tables = keyTables.map((name) => ({
      name,
      rows: rowCounts[name] ?? 0,
      sizeBytes: sizeMap.get(name) ?? 0,
    }));

    // Add any other tables with significant size that aren't in keyTables
    for (const t of tableSizes as { name: string; size_bytes: number }[]) {
      if (!keyTables.includes(t.name) && Number(t.size_bytes) > 0) {
        tables.push({
          name: t.name,
          rows: 0,
          sizeBytes: Number(t.size_bytes),
        });
      }
    }

    // Sort by size descending
    tables.sort((a, b) => b.sizeBytes - a.sizeBytes);

    return NextResponse.json({ totalSizeBytes, tables });
  },
  { requiredRole: "owner" }
);
