import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mappingContext, context } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addMappingContextSchema } from "@/lib/validators/mapping";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { id } = await params;

  const mcs = db
    .select()
    .from(mappingContext)
    .where(eq(mappingContext.fieldMappingId, id))
    .all();

  const withDetail = mcs.map((mc) => {
    const ctx = mc.contextId
      ? db.select().from(context).where(eq(context.id, mc.contextId)).get()
      : null;
    return {
      ...mc,
      contextName: ctx?.name ?? null,
      contextCategory: ctx?.category ?? null,
      contextPreview: ctx?.content?.slice(0, 120) ?? null,
    };
  });

  return NextResponse.json(withDetail);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = addMappingContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const input = parsed.data;

  const [created] = db
    .insert(mappingContext)
    .values({
      fieldMappingId: id,
      contextId: input.contextId,
      contextType: input.contextType || "context_reference",
      excerpt: input.excerpt,
      relevance: input.relevance,
    })
    .returning()
    .all();

  // Return with context name
  const ctx = input.contextId
    ? db.select().from(context).where(eq(context.id, input.contextId)).get()
    : null;

  return NextResponse.json(
    {
      ...created,
      contextName: ctx?.name ?? null,
      contextCategory: ctx?.category ?? null,
      contextPreview: ctx?.content?.slice(0, 120) ?? null,
    },
    { status: 201 }
  );
}
