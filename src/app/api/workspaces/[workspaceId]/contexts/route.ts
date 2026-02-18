import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createContextSchema } from "@/lib/validators/context";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";

export const GET = withAuth(async (req, ctx, { workspaceId }) => {
  const searchParams = req.nextUrl.searchParams;
  const category = searchParams.get("category");
  const subcategory = searchParams.get("subcategory");
  const entityId = searchParams.get("entityId");
  const fieldId = searchParams.get("fieldId");
  const isActive = searchParams.get("isActive");

  const conditions = [eq(context.workspaceId, workspaceId)];
  if (category) conditions.push(eq(context.category, category));
  if (subcategory) conditions.push(eq(context.subcategory, subcategory));
  if (entityId) conditions.push(eq(context.entityId, entityId));
  if (fieldId) conditions.push(eq(context.fieldId, fieldId));
  if (isActive !== null) {
    conditions.push(eq(context.isActive, isActive !== "false"));
  }

  const contexts = db
    .select()
    .from(context)
    .where(and(...conditions))
    .orderBy(context.sortOrder)
    .all();

  return NextResponse.json(contexts);
});

export const POST = withAuth(async (req, ctx, { workspaceId }) => {
  const body = await req.json();
  const parsed = createContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = db
    .insert(context)
    .values({
      workspaceId,
      name: input.name,
      category: input.category,
      subcategory: input.subcategory,
      entityId: input.entityId,
      fieldId: input.fieldId,
      content: input.content,
      contentFormat: input.contentFormat || "markdown",
      tags: input.tags,
      importSource: input.importSource,
    })
    .returning()
    .all();

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json(created, { status: 201 });
}, { requiredRole: "editor" });
