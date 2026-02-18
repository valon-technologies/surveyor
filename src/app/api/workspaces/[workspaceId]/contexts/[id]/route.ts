import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { updateContextSchema } from "@/lib/validators/context";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";

export const GET = withAuth(async (_req, routeCtx, { workspaceId }) => {
  const params = await routeCtx.params;
  const { id } = params;

  const ctx = db
    .select()
    .from(context)
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
    .get();

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

  const [updated] = db
    .update(context)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Context not found" }, { status: 404 });
  }

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json(updated);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (_req, routeCtx, { workspaceId }) => {
  const params = await routeCtx.params;
  const { id } = params;

  db.delete(context)
    .where(and(eq(context.id, id), eq(context.workspaceId, workspaceId)))
    .run();

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
