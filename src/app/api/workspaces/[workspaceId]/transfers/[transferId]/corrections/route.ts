import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { transferCorrection } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx, { workspaceId }) => {
  const { transferId } = await ctx.params;

  const corrections = await db
    .select()
    .from(transferCorrection)
    .where(
      and(
        eq(transferCorrection.transferId, transferId),
        eq(transferCorrection.workspaceId, workspaceId),
      ),
    )
    .orderBy(transferCorrection.createdAt);

  return NextResponse.json(corrections);
});

const VALID_TYPES = ["hard_override", "prompt_injection"];

export const POST = withAuth(async (req, ctx, { workspaceId, userId }) => {
  const { transferId } = await ctx.params;
  const body = await req.json();

  const {
    type,
    targetEntity,
    targetField,
    appliesTo,
    hasMapping,
    sourceFieldName,
    sourceFieldPosition,
    transformation,
    confidence,
    reasoning,
    contextUsed,
    note,
  } = body;

  if (!type || !targetEntity) {
    return NextResponse.json(
      { error: "type and targetEntity are required" },
      { status: 400 },
    );
  }

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const [correction] = await db
    .insert(transferCorrection)
    .values({
      transferId,
      workspaceId,
      type,
      targetEntity,
      targetField: targetField || null,
      appliesTo: appliesTo || null,
      hasMapping: hasMapping ?? null,
      sourceFieldName: sourceFieldName || null,
      sourceFieldPosition: sourceFieldPosition ?? null,
      transformation: transformation || null,
      confidence: confidence || null,
      reasoning: reasoning || null,
      contextUsed: contextUsed || null,
      note: note || null,
      createdBy: userId,
    })
    .returning();

  return NextResponse.json(correction, { status: 201 });
}, { requiredRole: "editor" });
