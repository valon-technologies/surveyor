import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { generation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;

  const gen = db
    .select()
    .from(generation)
    .where(and(eq(generation.id, id), eq(generation.workspaceId, workspaceId)))
    .get();

  if (!gen) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }

  return NextResponse.json(gen);
});
