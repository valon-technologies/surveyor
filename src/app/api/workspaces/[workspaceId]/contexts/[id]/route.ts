import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateContextSchema } from "@/lib/validators/context";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";
import { emitSignal } from "@/lib/generation/skill-signals";

export const GET = withAuth(async (_req, routeCtx, { workspaceId }) => {
  const params = await routeCtx.params;
  const { id } = params;

  const ctx = (await db
    .select()
    .from(context)
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
)[0];

  if (!ctx) {
    return NextResponse.json({ error: "Context not found" }, { status: 404 });
  }

  return NextResponse.json(ctx);
});

export const PATCH = withAuth(async (req, routeCtx, { workspaceId }) => {
  const params = await routeCtx.params;
  const { id } = params;
  const body = await req.json();
  const parsed = updateContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = await db
    .update(context)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
    .returning()
    ;

  if (!updated) {
    return NextResponse.json({ error: "Context not found" }, { status: 404 });
  }

  invalidateWorkspaceContextCache(workspaceId);

  try {
    emitSignal({
      workspaceId,
      signalType: "context_added",
      summary: `Context "${updated.name}" updated`,
      sourceId: updated.id,
      sourceType: "context",
    });
  } catch {
    // Non-critical — signal queue will catch up
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (_req, routeCtx, { workspaceId }) => {
  const params = await routeCtx.params;
  const { id } = params;

  await db.delete(context)
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
    ;

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
