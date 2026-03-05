import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { batchRun } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const POST = withAuth(
  async (_req, ctx, { workspaceId }) => {
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

    if (run.status !== "running" && run.status !== "pending") {
      return NextResponse.json({ error: "Batch run is not active" }, { status: 400 });
    }

    await db.update(batchRun)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(eq(batchRun.id, id))
      ;

    return NextResponse.json({ status: "cancelled" });
  },
  { requiredRole: "editor" }
);
