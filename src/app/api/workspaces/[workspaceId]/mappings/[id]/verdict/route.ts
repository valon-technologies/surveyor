import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { fieldMapping } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { extractVerdictLearning } from "@/lib/generation/mapping-learning";

export const PATCH = withAuth(
  async (req, ctx, { workspaceId }) => {
    const params = await ctx.params;
    const id = params.id;
    const body = (await req.json()) as {
      sourceVerdict?: string;
      sourceVerdictNotes?: string;
      transformVerdict?: string;
      transformVerdictNotes?: string;
    };

    const existing = db
      .select({ id: fieldMapping.id })
      .from(fieldMapping)
      .where(and(eq(fieldMapping.id, id), eq(fieldMapping.workspaceId, workspaceId)))
      .get();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, string | null> = {};
    if ("sourceVerdict" in body) updates.sourceVerdict = body.sourceVerdict ?? null;
    if ("sourceVerdictNotes" in body) updates.sourceVerdictNotes = body.sourceVerdictNotes ?? null;
    if ("transformVerdict" in body) updates.transformVerdict = body.transformVerdict ?? null;
    if ("transformVerdictNotes" in body) updates.transformVerdictNotes = body.transformVerdictNotes ?? null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    db.update(fieldMapping)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(fieldMapping.id, id))
      .run();

    const sourceVerdict = "sourceVerdict" in body ? body.sourceVerdict : undefined;
    const transformVerdict = "transformVerdict" in body ? body.transformVerdict : undefined;
    const shouldExtract =
      (sourceVerdict && sourceVerdict !== "correct") ||
      (transformVerdict && transformVerdict !== "correct");

    if (shouldExtract) {
      extractVerdictLearning(workspaceId, id);
    }

    return NextResponse.json({ success: true });
  },
  { requiredRole: "editor" }
);
