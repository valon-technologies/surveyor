import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { transfer, fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const { transferId } = await ctx.params;

  const [t] = await db
    .select()
    .from(transfer)
    .where(and(eq(transfer.id, transferId), eq(transfer.workspaceId, workspaceId)));

  if (!t) {
    return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  }

  return NextResponse.json(t);
});

export const PATCH = withAuth(async (req, ctx, { workspaceId }) => {
  const { transferId } = await ctx.params;
  const body = await req.json();

  // Only allow updating these fields
  const allowed: Record<string, unknown> = {};
  for (const key of ["name", "clientName", "description", "status"] as const) {
    if (body[key] !== undefined) {
      allowed[key] = body[key];
    }
  }

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(transfer)
    .set({ ...allowed, updatedAt: new Date().toISOString() })
    .where(and(eq(transfer.id, transferId), eq(transfer.workspaceId, workspaceId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (_req, ctx, { workspaceId }) => {
  const { transferId } = await ctx.params;

  // Delete field_mapping records scoped to this transfer (nullable FK, no cascade)
  await db
    .delete(fieldMapping)
    .where(eq(fieldMapping.transferId, transferId));

  // Delete the transfer (cascades to corrections)
  await db
    .delete(transfer)
    .where(and(eq(transfer.id, transferId), eq(transfer.workspaceId, workspaceId)));

  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
