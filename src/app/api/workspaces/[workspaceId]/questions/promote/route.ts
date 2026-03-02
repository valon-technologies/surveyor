import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { question } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Promote pending_review questions to draft (visible to admin curation queue).
 * Called when a reviewer clicks "Submit Review & Next".
 */
export const POST = withAuth(async (req, ctx, { workspaceId }) => {
  const body = await req.json();
  const { fieldMappingId } = body as { fieldMappingId: string };

  if (!fieldMappingId) {
    return NextResponse.json({ error: "fieldMappingId required" }, { status: 400 });
  }

  const result = db
    .update(question)
    .set({
      curationStatus: "draft",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(question.workspaceId, workspaceId),
        eq(question.fieldMappingId, fieldMappingId),
        eq(question.curationStatus, "pending_review"),
      )
    )
    .run();

  return NextResponse.json({ promoted: result.changes });
}, { requiredRole: "editor" });
