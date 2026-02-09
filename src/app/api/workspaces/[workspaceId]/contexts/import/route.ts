import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const body = await req.json();

  if (!Array.isArray(body.contexts)) {
    return NextResponse.json({ error: "Expected { contexts: [...] }" }, { status: 400 });
  }

  const created: typeof context.$inferSelect[] = [];

  for (const c of body.contexts) {
    if (!c.name || !c.category || !c.content) continue;

    const [ctx] = db
      .insert(context)
      .values({
        workspaceId,
        name: c.name,
        category: c.category,
        subcategory: c.subcategory,
        entityId: c.entityId,
        fieldId: c.fieldId,
        content: c.content,
        contentFormat: c.contentFormat || "markdown",
        tags: c.tags,
        importSource: c.importSource,
      })
      .returning()
      .all();

    created.push(ctx);
  }

  return NextResponse.json({ imported: created.length, contexts: created }, { status: 201 });
}
