import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { getSqliteDb } from "@/lib/db";
import { z } from "zod/v4";

const pruneSchema = z.object({
  target: z.enum(["chat_sessions", "generations", "prompt_snapshots"]),
  olderThanDays: z.number().int().positive().optional(),
});

export const POST = withAuth(
  async (req) => {
    const body = await req.json();
    const parsed = pruneSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    }

    const { target, olderThanDays } = parsed.data;
    const sqlite = getSqliteDb();

    let deleted = 0;

    const ageClause = olderThanDays
      ? `AND created_at < datetime('now', '-${olderThanDays} days')`
      : "";

    switch (target) {
      case "chat_sessions": {
        // Delete chat sessions (cascade deletes messages via FK)
        const result = sqlite
          .prepare(
            `DELETE FROM chat_session WHERE 1=1 ${ageClause}`
          )
          .run();
        deleted = result.changes;
        break;
      }
      case "generations": {
        const result = sqlite
          .prepare(
            `DELETE FROM generation WHERE 1=1 ${ageClause}`
          )
          .run();
        deleted = result.changes;
        break;
      }
      case "prompt_snapshots": {
        const result = sqlite
          .prepare(
            `UPDATE generation SET prompt_snapshot = NULL WHERE prompt_snapshot IS NOT NULL ${ageClause}`
          )
          .run();
        deleted = result.changes;
        break;
      }
    }

    return NextResponse.json({ deleted });
  },
  { requiredRole: "owner" }
);
