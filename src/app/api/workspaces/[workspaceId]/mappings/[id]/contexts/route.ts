import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { mappingContext, context } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addMappingContextSchema } from "@/lib/validators/mapping";

export const GET = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;

  const mcs = await db
    .select()
    .from(mappingContext)
    .where(eq(mappingContext.fieldMappingId, id))
    ;

  const withDetail = await Promise.all(mcs.map(async (mc) => {
    const ctxDoc = mc.contextId
      ? (await db.select().from(context).where(eq(context.id, mc.contextId)).limit(1))[0]
      : null;
    return {
      ...mc,
      contextName: ctxDoc?.name ?? null,
      contextCategory: ctxDoc?.category ?? null,
      contextPreview: ctxDoc?.content?.slice(0, 120) ?? null,
    };
  }));

  return NextResponse.json(withDetail);
});

export const POST = withAuth(async (req, ctx, { userId, workspaceId, role }) => {
  const params = await ctx.params;
  const { id } = params;
  const body = await req.json();
  const parsed = addMappingContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = await db
    .insert(mappingContext)
    .values({
      fieldMappingId: id,
      contextId: input.contextId,
      contextType: input.contextType || "context_reference",
      excerpt: input.excerpt,
      relevance: input.relevance,
    })
    .returning()
    ;

  // Return with context name
  const ctxDoc = input.contextId
    ? (await db.select().from(context).where(eq(context.id, input.contextId)).limit(1))[0]
    : null;

  return NextResponse.json(
    {
      ...created,
      contextName: ctxDoc?.name ?? null,
      contextCategory: ctxDoc?.category ?? null,
      contextPreview: ctxDoc?.content?.slice(0, 120) ?? null,
    },
    { status: 201 }
  );
}, { requiredRole: "editor" });
