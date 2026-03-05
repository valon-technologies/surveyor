import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { transferCorrection } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const PATCH = withAuth(async (req, ctx, { workspaceId }) => {
  const { correctionId } = await ctx.params;
  const body = await req.json();

  const allowedKeys = [
    "type",
    "targetEntity",
    "targetField",
    "appliesTo",
    "hasMapping",
    "sourceFieldName",
    "sourceFieldPosition",
    "transformation",
    "confidence",
    "reasoning",
    "contextUsed",
    "note",
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (body[key] !== undefined) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(transferCorrection)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(transferCorrection.id, correctionId),
        eq(transferCorrection.workspaceId, workspaceId),
      ),
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Correction not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });

export const DELETE = withAuth(async (_req, ctx, { workspaceId }) => {
  const { correctionId } = await ctx.params;

  await db
    .delete(transferCorrection)
    .where(
      and(
        eq(transferCorrection.id, correctionId),
        eq(transferCorrection.workspaceId, workspaceId),
      ),
    );

  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
