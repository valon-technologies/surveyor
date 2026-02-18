import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { field } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { MILESTONES } from "@/lib/constants";

const updateFieldSchema = z.object({
  milestone: z.enum(MILESTONES).nullable().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
});

export const PATCH = withAuth(async (req, ctx, { workspaceId }) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = updateFieldSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [updated] = db
    .update(field)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(field.id, id))
    .returning()
    .all();

  if (!updated) {
    return NextResponse.json({ error: "Field not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}, { requiredRole: "editor" });
