import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { getSqliteDb } from "@/lib/db";

export const GET = withAuth(
  async () => {
    const sqlite = getSqliteDb();

    // Get per-table sizes via dbstat virtual table
    const tableSizes = sqlite
      .prepare(
        `SELECT name, SUM(pgsize) as size_bytes
         FROM dbstat
         GROUP BY name
         ORDER BY size_bytes DESC`
      )
      .all() as { name: string; size_bytes: number }[];

    // Get total DB size
    const pageCount = sqlite.prepare("PRAGMA page_count").get() as {
      page_count: number;
    };
    const pageSize = sqlite.prepare("PRAGMA page_size").get() as {
      page_size: number;
    };
    const totalSizeBytes = pageCount.page_count * pageSize.page_size;

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
        const result = sqlite
          .prepare(`SELECT COUNT(*) as count FROM "${table}"`)
          .get() as { count: number };
        rowCounts[table] = result.count;
      } catch {
        // Table may not exist yet
        rowCounts[table] = 0;
      }
    }

    // Merge sizes with row counts
    const sizeMap = new Map(tableSizes.map((t) => [t.name, t.size_bytes]));

    const tables = keyTables.map((name) => ({
      name,
      rows: rowCounts[name] ?? 0,
      sizeBytes: sizeMap.get(name) ?? 0,
    }));

    // Add any other tables with significant size that aren't in keyTables
    for (const t of tableSizes) {
      if (!keyTables.includes(t.name) && t.size_bytes > 0) {
        tables.push({
          name: t.name,
          rows: 0,
          sizeBytes: t.size_bytes,
        });
      }
    }

    // Sort by size descending
    tables.sort((a, b) => b.sizeBytes - a.sizeBytes);

    return NextResponse.json({ totalSizeBytes, tables });
  },
  { requiredRole: "owner" }
);
