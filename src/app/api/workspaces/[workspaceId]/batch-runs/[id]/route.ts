import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { batchRun } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const params = await ctx.params;
  const id = params.id;

  const run = (await db
    .select()
    .from(batchRun)
    .where(and(eq(batchRun.id, id), eq(batchRun.workspaceId, workspaceId)))
)[0];

  if (!run) {
    return NextResponse.json({ error: "Batch run not found" }, { status: 404 });
  }

  return NextResponse.json(run);
});
