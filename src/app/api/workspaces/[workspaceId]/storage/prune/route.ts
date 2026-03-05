import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { chatSession, generation } from "@/lib/db/schema";
import { sql, lt } from "drizzle-orm";
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
    let deleted = 0;

    const cutoff = olderThanDays
      ? new Date(Date.now() - olderThanDays * 86400000).toISOString()
      : null;

    switch (target) {
      case "chat_sessions": {
        const condition = cutoff ? lt(chatSession.createdAt, cutoff) : undefined;
        const result = await db.delete(chatSession).where(condition);
        deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
        break;
      }
      case "generations": {
        const condition = cutoff ? lt(generation.createdAt, cutoff) : undefined;
        const result = await db.delete(generation).where(condition);
        deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
        break;
      }
      case "prompt_snapshots": {
        const condition = cutoff
          ? sql`${generation.promptSnapshot} IS NOT NULL AND ${generation.createdAt} < ${cutoff}`
          : sql`${generation.promptSnapshot} IS NOT NULL`;
        const result = await db.update(generation).set({ promptSnapshot: null }).where(condition);
        deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
        break;
      }
    }

    return NextResponse.json({ deleted });
  },
  { requiredRole: "owner" }
);
