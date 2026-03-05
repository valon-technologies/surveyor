import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/api-auth";
import { db } from "@/lib/db";
import { context } from "@/lib/db/schema";
import { invalidateWorkspaceContextCache } from "@/lib/generation/context-cache";

export const POST = withAuth(async (req, ctx, { workspaceId }) => {
  const body = await req.json();

  if (!Array.isArray(body.contexts)) {
    return NextResponse.json({ error: "Expected { contexts: [...] }" }, { status: 400 });
  }

  const created: typeof context.$inferSelect[] = [];

  for (const c of body.contexts) {
    if (!c.name || !c.category || !c.content) continue;

    const [item] = await db
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
      ;

    created.push(item);
  }

  invalidateWorkspaceContextCache(workspaceId);
  return NextResponse.json({ imported: created.length, contexts: created }, { status: 201 });
}, { requiredRole: "editor" });
