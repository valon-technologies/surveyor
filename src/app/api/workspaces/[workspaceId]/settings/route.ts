import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET — return workspace settings
export const GET = withAuth(async (_req, _ctx, { workspaceId }) => {
  const row = db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .get();

  return NextResponse.json(row?.settings || {});
});

// PATCH — merge incoming settings
export const PATCH = withAuth(async (req, _ctx, { workspaceId }) => {
  const body = await req.json();

  const row = db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .get();

  const existing = (row?.settings as Record<string, unknown>) || {};
  const merged = { ...existing, ...body };

  db.update(workspace)
    .set({ settings: merged, updatedAt: new Date().toISOString() })
    .where(eq(workspace.id, workspaceId))
    .run();

  return NextResponse.json(merged);
}, { requiredRole: "editor" });
