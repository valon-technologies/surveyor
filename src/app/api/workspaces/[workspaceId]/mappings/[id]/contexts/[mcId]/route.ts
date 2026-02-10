import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { mappingContext } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const DELETE = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { mcId } = params;

  await db.delete(mappingContext).where(eq(mappingContext.id, mcId));

  return NextResponse.json({ success: true });
}, { requiredRole: "editor" });
